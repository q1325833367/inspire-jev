[简体中文](README.md) | [English](README.en.md)

# InspireJev

**Turn ideas into actions with Jev.**

A Jev-powered execution toolkit, starting with browser automation.

[![Version: 1.0.0-rc.8](https://img.shields.io/badge/version-1.0.0--rc.8-orange)](https://github.com/q1325833367/inspire-jev/releases/tag/v1.0.0-rc.8)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

InspireJev lets a main agent use Jev tools first for continuous browser execution, including search, filtering, data collection, and form filling. The main agent retains the full objective and handles planning, authorization, verification, and takeover. Jev selects actions from candidates observed on the current page.

This version is a **release candidate**: core CI regressions and the real browser adapter flow have passed on six platforms, with local core regressions passing on macOS. Native Windows 11 ARM64 validation covers Pi, MCP, a 51-action real-site task, and restart/resume. The 54-run formal acceptance suite and speed comparison remain unfinished. See the [compatibility matrix](docs/COMPATIBILITY.md) and [acceptance protocol](docs/ACCEPTANCE.md) for evidence and gates.

## How it works

`Main agent plans and verifies → InspireJev execution core → TypeSafe / Jev action decisions → Playwright browser → Page evidence`

- Execute natural business stages and return structured data with sources.
- Fill known values through the execution core; optionally use DeepSeek to generate new text.
- Verify completion conditions, with checkpoints, resume, cancellation, and takeover in the same browser state.
- Each host owns separate browser sessions and profiles. Users sign in manually in the controlled browser.

Runtime dependencies: **Node.js 24+**, Playwright 1.63, MCP SDK, Undici, Zod, and cross-spawn. See the [architecture guide](docs/ARCHITECTURE.md) for execution and permission boundaries.

## Installation and quickstart

Install Node.js 24 or later, then install the RC release package and Chromium:

```sh
npm install --global https://github.com/q1325833367/inspire-jev/releases/download/v1.0.0-rc.8/inspire-jev-1.0.0-rc.8.tgz
npx playwright@1.63.0 install chromium
inspire-jev setup
inspire-jev install --entry gpt
inspire-jev doctor
```

`setup` guides configuration in an interactive terminal and masks API key input. You can also reference an existing private configuration file outside the repository:

```sh
inspire-jev setup --env-file /path/outside/repo/credentials.env
```

After installing an entry, reload the host as instructed by the installer and describe a browser task in your conversation, for example:

> Find the first three books by a specified author, open each detail page, and collect titles, reading formats, and source links.

See the [installation guide](docs/INSTALLATION.md) for platform prerequisites, host configuration locations, and troubleshooting.

## Model and network configuration

Browser action decisions use TypeSafe / Jev; new text generation uses an optional text model. Providers, API endpoints, and model names are configurable.

| Setting | Purpose | Default |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Required Jev decision API key | None |
| `TYPESAFE_BASE_URL` | Jev API endpoint | `https://api.typesafe.ai/v1/systemone` |
| `TYPESAFE_MODEL` | Jev model | `jev-latest` |
| `TEXT_MODEL_API_KEY` | Text generation key, when needed | None |
| `TEXT_MODEL_BASE_URL` | Text model API endpoint | `https://api.deepseek.com/v1` |
| `TEXT_MODEL` | Text model | `deepseek-chat` |

Inspect configuration or update a key interactively:

```sh
inspire-jev config show
inspire-jev config set TYPESAFE_API_KEY
inspire-jev doctor --models
```

`doctor --models` makes real calls to configured model APIs. Model requests and browser traffic use separate explicit HTTP proxy settings, `modelProxy` and `browserProxy`, or direct connections; TUN is not required. Keep keys in private local files. See the [configuration guide](docs/CONFIGURATION.md) for proxies and configuration precedence.

## GPT, Pi, and MCP entries

Install the entry you need, or install all entries:

```sh
inspire-jev install --entry gpt
inspire-jev install --entry pi
inspire-jev install --entry mcp
inspire-jev install --entry all
```

| Entry | Usage |
| --- | --- |
| GPT | The installer configures the host plugin and browser skill; load them as instructed by the host |
| Pi | The installer configures the Pi extension and skill; load them as instructed by the host |
| Generic MCP | Add the installer-generated configuration to a client that supports stdio MCP |

Start the generic MCP server with:

```sh
inspire-jev mcp --host mcp
```

The installer prints MCP configuration using absolute paths to Node and the installed CLI for host subprocesses. On non-Windows systems, clients can also use the `inspire-jev` command. See the [installation guide](docs/INSTALLATION.md) for entry details.

All three entries expose the same five tools:

| Tool | Purpose |
| --- | --- |
| `jev_session` | Open, inspect, take over, or close a browser session |
| `jev_run` | Execute a task continuously through business stages |
| `jev_resume` | Check the current state and continue from a checkpoint |
| `jev_status` | Inspect status, evidence, collected data, and remaining requirements |
| `jev_cancel` | Stop issuing new actions and retain recovery information |

See the [public API](docs/API.md) for parameters and states.

## Platform verification status

| Platform | Current verification status |
| --- | --- |
| macOS | ARM64 / x64 CI regressions and real browser adapter flow passed; formal host acceptance is unfinished |
| Windows | Windows 11 ARM64 / Server x64 CI passed; local ARM64 validation covers Pi, MCP, cancellation, recovery, and the installation lifecycle |
| Linux | ARM64 / x64 CI regressions and real browser adapter flow passed |

The [compatibility matrix](docs/COMPATIBILITY.md) records host versions, entries, browser capabilities, and platform prerequisites. The [acceptance protocol](docs/ACCEPTANCE.md) tracks the 54-case formal suite.

## Examples

Typical tasks include searching and filtering results, comparing detail pages, collecting web tables, locating sections with sources, and filling drafts after the user has signed in.

For direct tool calls, first open an allowed origin with `jev_session`:

The default browser profile persists across sessions, runtime restarts, and upgrades. Existing installations can list profiles with `profiles` and select a default with `useProfile`. Specify a new `profileId` only when account isolation is needed. A website may expire a login; profiles remain separate between hosts.

```json
{
  "action": "open",
  "url": "https://example.com/",
  "allowedOrigins": ["https://example.com"]
}
```

Replace `SESSION_ID` with the returned session ID and send the task to `jev_run`:

```json
{
  "task": {
    "sessionId": "SESSION_ID",
    "requestId": "SESSION_ID-read-001",
    "goal": "Read the current page title and return its source link",
    "allowedOrigins": ["https://example.com"],
    "subgoals": [{
      "id": "read",
      "goal": "Collect the page title and source",
      "checks": [
        {"kind": "title", "notEmpty": true},
        {"kind": "url", "equals": "https://example.com/"}
      ],
      "extract": [
        {"name": "title", "source": "title"},
        {"name": "url", "source": "url"}
      ]
    }],
    "completionChecks": [{"kind": "evidence", "subgoal": "read"}]
  }
}
```

For `running`, continue with `jev_resume`. For `handoff`, the main agent inspects the same browser state before taking over. `verified` means all specified checks passed; the main agent must still confirm those checks cover the original business request. See the [browser skill](skills/jev-browser/SKILL.md) and [public API](docs/API.md) for more planning examples.

## Boundaries

- Users or hosts handle sign-in, verification codes, and sensitive input; personal browser cookies are not copied.
- The main agent defines allowed origins and submission authorization. Payments, publication, and deletion use the host's authorization mechanisms.
- Observe again after page changes. Inspect uncertain submission effects before choosing a follow-up action.
- Canvas, Shadow DOM, and other content outside DOM observation may require takeover.
- The default total budget is 90 seconds / 40 actions, with at most 45 seconds per slice. Long tasks allow up to 15 minutes / 200 actions.

Model service fees and website access conditions are determined by their providers. See the [security policy](SECURITY.md) for reporting security issues.

## Upgrade and uninstall

```sh
inspire-jev upgrade --package /path/to/inspire-jev-VERSION.tgz
inspire-jev rollback --version VERSION
inspire-jev uninstall --entry gpt
```

Uninstall accepts `gpt`, `pi`, `mcp`, or `all`. See the [changelog](CHANGELOG.md) for version changes and the [installation guide](docs/INSTALLATION.md) for upgrades, rollback, and local data handling.

## Contributing

Feedback from real use helps shape the project. Share where an agent gets stuck, reproducible failures, or new use cases worth supporting. Testing, documentation, and usability suggestions are welcome contributions too.

- **Report a problem:** Include the version, operating system, integration, reproduction steps, and redacted evidence in [Issues](https://github.com/q1325833367/inspire-jev/issues).
- **Discuss an idea:** Use [Discussions](https://github.com/q1325833367/inspire-jev/discussions) for use cases, executor design, and new host integrations. Discuss larger changes before implementing them.
- **Submit an improvement:** Bug fixes, documentation, and compatibility validation are welcome. See the [contribution guide](CONTRIBUTING.md) for development and submission requirements. Report security issues privately through the [security channel](SECURITY.md).

## Contact and collaboration

I'm **q1325833367**, an independent developer using AI to turn ideas into useful open-source tools. I'd like to connect with others who are building things, exchange practical experience, try new ideas together, and improve our projects.

If you have an idea, want to build a project together, or are part of a community that collaborates on open source and shares hands-on work, feel free to get in touch. Public discussions are welcome on Discussions so others can take part.

Email: [1325833367@qq.com](mailto:1325833367@qq.com). A short introduction to what you're working on and what you'd like to discuss is enough.

## License and attribution

This project is [MIT licensed](LICENSE), retaining `Copyright (c) 2026 Browser Use` and `Copyright (c) 2026 q1325833367`.

InspireJev builds on [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) at commit [`1231850a0bf1a0c0341fe408ef1668dbbfdfac46`](https://github.com/browser-use/jev-ultrafast/commit/1231850a0bf1a0c0341fe408ef1668dbbfdfac46), with thanks to its authors. Related references: the official [Browser Use docs](https://docs.browser-use.com/) and [Playwright docs](https://playwright.dev/docs/intro). See [attribution](docs/ATTRIBUTION.md) for provenance and dependency licenses.
