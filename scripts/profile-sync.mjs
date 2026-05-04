import { gzipSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'

function makeStroke(index) {
  const x = 80 + (index % 80) * 12
  const y = 90 + Math.floor(index / 80) * 12
  return `<path d="M${x} ${y} C${x + 8} ${y - 6},${x + 16} ${y + 6},${x + 24} ${y}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
}

function makeDrawing(strokes) {
  return Array.from({ length: strokes }, (_, index) => makeStroke(index)).join('\n')
}

function makeBoard(index, strokes = 0) {
  const now = 1_778_000_000_000 + index
  return {
    id: `board-${index + 1}`,
    title: `Board ${index + 1}`,
    createdAt: now,
    updatedAt: now,
    drawing: makeDrawing(strokes),
  }
}

function payloadMetrics(payload, iterations) {
  const json = JSON.stringify(payload)
  const parseStarted = performance.now()
  for (let index = 0; index < iterations; index += 1)
    JSON.parse(json)
  const parseMs = performance.now() - parseStarted

  const stringifyStarted = performance.now()
  for (let index = 0; index < iterations; index += 1)
    JSON.stringify(payload)
  const stringifyMs = performance.now() - stringifyStarted

  return {
    bytes: Buffer.byteLength(json),
    gzipBytes: gzipSync(json).byteLength,
    iterations,
    parseMs,
    parsePerOpMs: parseMs / iterations,
    stringifyMs,
    stringifyPerOpMs: stringifyMs / iterations,
  }
}

function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

function formatMs(ms) {
  return `${ms.toFixed(2)} ms`
}

function makeStrokePayload(activeBoard, label) {
  return {
    activeBoardId: activeBoard.id,
    activeDrawing: `${activeBoard.drawing}${activeBoard.drawing ? '\n' : ''}${makeStroke(999_999)}`,
    boardTheme: 'blackboard',
    boards: undefined,
    stateId: `profile-${label}`,
    stateSource: 'presenter',
    stateTime: Date.now(),
  }
}

function makeBoardOperationPayload(activeBoard, operation, label) {
  return {
    activeBoardId: activeBoard.id,
    activeDrawing: undefined,
    boardOperation: operation,
    boardTheme: 'blackboard',
    boards: undefined,
    stateId: `profile-${label}`,
    stateSource: 'presenter',
    stateTime: Date.now(),
  }
}

function summarizeMetric(metric) {
  if (!metric)
    return 'n/a'

  return [
    `${formatBytes(metric.bytes)} raw`,
    `${formatBytes(metric.gzipBytes)} gzip`,
    `stringify ${formatMs(metric.stringifyPerOpMs)}`,
    `parse ${formatMs(metric.parsePerOpMs)}`,
  ].join(', ')
}

function runScenario({ boards, strokesPerBoard, iterations }) {
  const boardList = Array.from({ length: boards }, (_, index) => makeBoard(index, strokesPerBoard))
  const activeBoard = boardList[0]
  const addedBoard = makeBoard(boards, 0)
  const removeActiveBoard = boardList[boards > 1 ? 1 : 0]

  const stroke = payloadMetrics(makeStrokePayload(activeBoard, 'stroke'), iterations)
  const add = payloadMetrics(makeBoardOperationPayload(addedBoard, {
    board: addedBoard,
    index: boards,
    type: 'upsert',
  }, 'add-board'), iterations)
  const remove = boards > 1
    ? payloadMetrics(makeBoardOperationPayload(removeActiveBoard, {
        boardId: activeBoard.id,
        type: 'remove',
      }, 'remove-board'), iterations)
    : undefined

  return {
    boards,
    strokesPerBoard,
    iterations,
    stroke,
    add,
    remove,
  }
}

const scenarios = [
  { boards: 1, strokesPerBoard: 25, iterations: 200 },
  { boards: 1, strokesPerBoard: 100, iterations: 200 },
  { boards: 10, strokesPerBoard: 100, iterations: 50 },
  { boards: 25, strokesPerBoard: 100, iterations: 20 },
  { boards: 50, strokesPerBoard: 100, iterations: 10 },
  { boards: 100, strokesPerBoard: 100, iterations: 5 },
  { boards: 100, strokesPerBoard: 250, iterations: 5 },
  { boards: 100, strokesPerBoard: 500, iterations: 3 },
]

console.log('Slidev blackboard sync payload profile')
console.log('Current protocol profile: extra stroke is active-board-only; add/remove boards are incremental operations.\n')

for (const result of scenarios.map(runScenario)) {
  console.log(`${result.boards} board(s), ${result.strokesPerBoard} strokes/board (${result.iterations}x timing loop)`)
  console.log(`  extra stroke: ${summarizeMetric(result.stroke)}`)
  console.log(`  add board:    ${summarizeMetric(result.add)}`)
  console.log(`  remove board: ${summarizeMetric(result.remove)}`)
  console.log(`  add/stroke raw ratio:    ${(result.add.bytes / result.stroke.bytes).toFixed(1)}x`)
  console.log(`  remove/stroke raw ratio: ${result.remove ? `${(result.remove.bytes / result.stroke.bytes).toFixed(1)}x` : 'n/a'}\n`)
}
