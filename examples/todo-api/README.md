# Todo API demo

This demo exercises HarnessCheck without model credentials or network calls. The deterministic `fake-agent.mjs` adds a health module, HarnessCheck runs two isolated trials, verifies the resulting file change, and runs the fixture's real `npm test` command as an assertion.

Verified locally on **August 31, 2026**:

```bash
npm install
npm run build
node dist/cli.js -c examples/todo-api/harnesscheck.yaml run --run-id local-demo
```

Reports land in:

- `examples/todo-api/.harnesscheck/reports/local-demo/report.json`
- `examples/todo-api/.harnesscheck/reports/local-demo/report.html`
- `examples/todo-api/.harnesscheck/reports/local-demo/report.junit.xml`
- `examples/todo-api/.harnesscheck/reports/local-demo/report.md`

To compare a real agent, replace `fixture-agent` with a built-in adapter or a custom wrapper in `examples/todo-api/harnesscheck.yaml`.
