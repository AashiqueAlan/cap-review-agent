# CAP rule pack (used by the CAP agent)

Each rule: id, severity, applies-to, rule, bad/good, source (the URL a finding may cite).

id: CAP-001
severity: critical
applies-to: package.json, .cdsrc.json
rule: A production profile must use a real database (HANA). If `cds.requires.db` is sqlite / in-memory with no `[production]` override, all data is lost on restart.
bad: "db": { "kind": "sqlite", "credentials": { "url": ":memory:" } }
good: "[production]": { "db": { "kind": "hana" } } plus an hdi-shared resource bound in mta.yaml
source: https://cap.cloud.sap/docs/guides/deploy/to-cf.md

id: CAP-002
severity: high
applies-to: package.json
rule: `@cap-js/sqlite`, `sqlite3`, H2 etc. belong in devDependencies, not dependencies. Otherwise production installs them.
bad: "dependencies": { "@cap-js/sqlite": "^2" }
good: "devDependencies": { "@cap-js/sqlite": "^2" }
source: https://cap.cloud.sap/docs/guides/databases/sqlite

id: CAP-003
severity: critical
applies-to: package.json, .cdsrc.json, srv/*.cds
rule: Production must use real authentication (`xsuaa`/`ias`), not `mocked` or `dummy`. Services need @requires or @restrict unless they are intentionally public (then @requires: 'any' with a comment).
bad: service Admin { entity Books as projection on db.Books; }
good: @requires: 'authenticated-user' service Admin { ... }
source: https://cap.cloud.sap/docs/node.js/authentication

id: CAP-004
severity: high
applies-to: *.js, *.ts, package.json, .cdsrc.json
rule: No hardcoded URLs, passwords, tokens or destination credentials. Use env vars, service bindings or BTP destinations.
bad: credentials: { user: "admin", password: "secret" }
good: credentials from the binding, or { "$env": "MAIL_PASS" }
source: https://cap.cloud.sap/docs/node.js/remote-services.md

id: CAP-005
severity: high
applies-to: package.json, .cdsrc.json
rule: Remote services (S/4, APIs) need a destination in production. Environment names (DEV-100-...) must not appear in config; use a landscape-neutral destination name. Prefer Principal Propagation / OAuth2SAMLBearerAssertion over a shared Basic-auth user when writing on behalf of users.
bad: "destination": "DEV-100-BasicAuthentication"
good: "[production]": { "kind": "odata-v2", "credentials": { "destination": "S4_BACKEND" } }
source: https://cap.cloud.sap/docs/node.js/remote-services.md

id: CAP-006
severity: critical
applies-to: package.json, .cdsrc.json
rule: Mail / messaging / other `kind: console` or `file` mocks must not be the production setting (for example OTP mails only written to logs).
bad: "mail": { "[production]": { "kind": "console" } }
good: "[production]": { "kind": "smtp", "credentials": { "host": { "$env": "MAIL_HOST" } } }
source: https://cap.cloud.sap/docs/guides/deploy/to-cf.md

id: CAP-007
severity: medium
applies-to: srv/*.js, srv/*.ts
rule: No DB or remote calls inside loops (N+1). Batch with one SELECT ... WHERE IN, or INSERT.entries([...]).
bad: for (const id of ids) await SELECT.one.from(Books).where({ID:id})
good: await SELECT.from(Books).where({ ID: { in: ids } })
source: https://cap.cloud.sap/docs/node.js/cds-ql

id: CAP-008
severity: high
applies-to: srv/*.js, srv/*.ts
rule: Build queries with cds.ql / CQN and parameters. Never concatenate user input into SQL strings (injection).
bad: cds.run(`SELECT * FROM books WHERE title='${req.data.title}'`)
good: SELECT.from(Books).where({ title: req.data.title })
source: https://cap.cloud.sap/docs/node.js/cds-ql

id: CAP-009
severity: medium
applies-to: srv/*.cds, db/*.cds
rule: Validate input with annotations (@mandatory, @assert.range, @assert.format). Use the `managed` aspect and `cuid` where audit fields or UUID keys are expected. Entities need keys.
bad: entity Orders { amount: Integer; }
good: entity Orders : cuid, managed { amount: Integer @assert.range: [0, 1000000]; }
source: https://cap.cloud.sap/docs/guides/domain/

id: CAP-010
severity: medium
applies-to: srv/*.js, srv/*.ts
rule: Handlers report errors with req.error() / req.reject() (right HTTP code). Do not swallow exceptions, and stop after req.reject.
bad: try { ... } catch (e) { }
good: return req.reject(400, 'INVALID_AMOUNT')
source: https://cap.cloud.sap/docs/node.js/events
