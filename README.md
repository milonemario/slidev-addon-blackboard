# slidev-addon-blackboard

Presenter blackboard overlays, persistent boards, guide layers, and exhibit tools for Slidev decks.

## Install

```sh
npm install slidev-addon-blackboard
```

Add the addon to your `slides.md` frontmatter:

```md
---
addons:
  - blackboard
---
```

Or declare it in your deck `package.json`:

```json
{
  "slidev": {
    "addons": [
      "blackboard"
    ]
  }
}
```

## Features

- Toggle a blackboard or whiteboard overlay during presentation.
- Draw, erase, undo, redo, and navigate across multiple board pages.
- Persist boards to `.slidev/blackboards` for live reuse.
- Add presenter-only guide boards that sit underneath the live board as a private prompt.
- Load pre-made live board sets that are shown during the presentation.
- Insert table, Mermaid, image, and SVG exhibits from deck assets.
- Include blackboard pages in export and build flows.

## Blackboard Types

The addon supports a few different board sources, depending on how you want to present:

- Live blackboards are the boards you draw on during the presentation. They can be blank, persistent, or loaded from a pre-made set.
- Guide blackboards are pre-made boards visible only to the presenter. They appear underneath the live blackboard at a configurable opacity, which makes them useful for prompts, solution outlines, diagrams, or timing cues that should not be shown to the audience.
- Pre-made live blackboards are pre-written boards that appear as the live boards during the presentation. Use them when you want prepared writing, diagrams, or annotations to show up for the audience without redrawing them live.
- Saved live blackboards are boards captured during the presentation, that are used when exporting.

## Configuration

The addon reads the `blackboard` frontmatter option from your deck.

```md
---
addons:
  - blackboard
blackboard:
  persist: true
  guide:
    enabled: true
    opacity: 0.22
  export:
    include: true
    background: whiteboard
  build:
    append: true
    background: whiteboard
---
```

Common options:

- `blackboard: false` disables the addon for a deck.
- `blackboard.enabled` can be `true`, `false`, `dev`, `build`, or `export`.
- `blackboard.persist: true` stores live boards under `.slidev/blackboards/<deck-name>`.
- `blackboard.persist: "./path"` stores live boards at a custom path.
- `blackboard.guide.enabled` enables guide board sets.
- `blackboard.export.include` includes blackboard pages in export mode.
- `blackboard.build.append` appends blackboard slides during static builds.

## Board Assets

When persistence is enabled, the addon looks under `.slidev/blackboards` by default:

```text
.slidev/blackboards/
  exhibits/
  guides/
  prefilled-live/
  saved-live/
```

Use `guides` for presenter-only guide boards. Use `prefilled-live` for pre-made live blackboards that should be visible as live boards during the talk. Use `saved-live` for boards persisted from previous presentation sessions.

The `exhibits` folder can contain Markdown tables, Mermaid files, SVG files, and image assets. The deck `public` folder is also exposed as a deck-assets exhibit source.

## Requirements

This addon targets Slidev `>=52.0.0`.

## Development

```sh
npm run check:pack
```

Slidev compiles addon `.vue` and `.ts` files directly, so the package intentionally publishes source files rather than a bundled build.

## License

MIT
