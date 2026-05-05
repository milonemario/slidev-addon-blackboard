import { gzipSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'

const elementIdAttribute = 'data-blackboard-element-id'

function makeStroke(index) {
  const x = 80 + (index % 80) * 12
  const y = 90 + Math.floor(index / 80) * 12
  return `<path ${elementIdAttribute}="bbe-${index}" d="M${x} ${y} C${x + 8} ${y - 6},${x + 16} ${y + 6},${x + 24} ${y}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
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

function basePayload(activeBoardId, label) {
  return {
    activeBoardId,
    boardTheme: 'blackboard',
    stateId: `profile-${label}`,
    stateSource: 'presenter',
    stateTime: Date.now(),
    syncClientId: 'profile-client',
    syncSeq: 1,
  }
}

function drawingPayload(activeBoard, operation, label) {
  return {
    ...basePayload(activeBoard.id, label),
    drawingOperation: operation,
  }
}

function boardPayload(activeBoard, operation, label) {
  return {
    ...basePayload(activeBoard.id, label),
    boardOperation: operation,
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
    parsePerOpMs: parseMs / iterations,
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
  const finalStroke = makeStroke(999_999)
  const addedBoard = makeBoard(boards, 0)
  const restoredElement = makeStroke(888_888)
  const previewStroke = makeStroke(777_777).replace(`${elementIdAttribute}="bbe-777777"`, 'data-blackboard-preview-id="preview-777777"')

  const livePreview = payloadMetrics(drawingPayload(activeBoard, {
    elementSvg: previewStroke,
    index: strokesPerBoard,
    previewId: 'preview-777777',
    type: 'previewElement',
  }, 'live-preview'), iterations)

  const finalStrokeUpsert = payloadMetrics(drawingPayload(activeBoard, {
    elementId: 'bbe-999999',
    elementSvg: finalStroke,
    index: strokesPerBoard,
    previewId: 'preview-777777',
    type: 'upsertElement',
  }, 'final-stroke'), iterations)

  const eraser1 = payloadMetrics(drawingPayload(activeBoard, {
    elementIds: ['bbe-1'],
    type: 'removeElements',
  }, 'eraser-1'), iterations)

  const eraser5 = payloadMetrics(drawingPayload(activeBoard, {
    elementIds: Array.from({ length: 5 }, (_, index) => `bbe-${index + 1}`),
    type: 'removeElements',
  }, 'eraser-5'), iterations)

  const eraser20 = payloadMetrics(drawingPayload(activeBoard, {
    elementIds: Array.from({ length: 20 }, (_, index) => `bbe-${index + 1}`),
    type: 'removeElements',
  }, 'eraser-20'), iterations)

  const undoRemove = eraser1
  const redoRestore = payloadMetrics(drawingPayload(activeBoard, {
    elementId: 'bbe-888888',
    elementSvg: restoredElement,
    index: Math.max(0, strokesPerBoard - 1),
    type: 'upsertElement',
  }, 'redo-restore'), iterations)

  const fallbackReplace = payloadMetrics(drawingPayload(activeBoard, {
    drawing: activeBoard.drawing,
    type: 'replaceDrawing',
  }, 'replace-drawing'), iterations)

  const addBoard = payloadMetrics(boardPayload(addedBoard, {
    board: addedBoard,
    index: boards,
    type: 'upsert',
  }, 'add-board'), iterations)

  const removeBoard = boards > 1
    ? payloadMetrics(boardPayload(boardList[1], {
        boardId: activeBoard.id,
        type: 'remove',
      }, 'remove-board'), iterations)
    : undefined

  return {
    addBoard,
    boards,
    eraser1,
    eraser5,
    eraser20,
    fallbackReplace,
    finalStrokeUpsert,
    iterations,
    livePreview,
    redoRestore,
    removeBoard,
    strokesPerBoard,
    undoRemove,
  }
}

const scenarios = [
  { boards: 1, strokesPerBoard: 100, iterations: 200 },
  { boards: 10, strokesPerBoard: 100, iterations: 50 },
  { boards: 50, strokesPerBoard: 100, iterations: 10 },
  { boards: 100, strokesPerBoard: 100, iterations: 5 },
  { boards: 100, strokesPerBoard: 250, iterations: 5 },
  { boards: 100, strokesPerBoard: 500, iterations: 3 },
]

console.log('Slidev blackboard sync payload profile')
console.log('Current protocol profile: drawing element deltas, fallback active-board replacement, and board operations.\n')

for (const result of scenarios.map(runScenario)) {
  console.log(`${result.boards} board(s), ${result.strokesPerBoard} strokes on active board (${result.iterations}x timing loop)`)
  console.log(`  live preview:        ${summarizeMetric(result.livePreview)}`)
  console.log(`  final stroke upsert: ${summarizeMetric(result.finalStrokeUpsert)}`)
  console.log(`  eraser remove 1:     ${summarizeMetric(result.eraser1)}`)
  console.log(`  eraser remove 5:     ${summarizeMetric(result.eraser5)}`)
  console.log(`  eraser remove 20:    ${summarizeMetric(result.eraser20)}`)
  console.log(`  undo remove:         ${summarizeMetric(result.undoRemove)}`)
  console.log(`  redo restore:        ${summarizeMetric(result.redoRestore)}`)
  console.log(`  fallback replace:    ${summarizeMetric(result.fallbackReplace)}`)
  console.log(`  add board:           ${summarizeMetric(result.addBoard)}`)
  console.log(`  remove board:        ${summarizeMetric(result.removeBoard)}`)
  console.log(`  fallback/final-stroke raw ratio: ${(result.fallbackReplace.bytes / result.finalStrokeUpsert.bytes).toFixed(1)}x\n`)
}
