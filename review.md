SAP BTP Best Practices Review — Container_Inspection_mta
Reviewed against: SAP BTP Cloud Foundry MTA docs, xs-security.json syntax docs, CAP deploy guide, approuter FAQ (SAP Community), BTP connectivity service docs.

Section 1 — Is claims-srv justified or over-engineered?
Verdict: Fully justified. A CAP service is the correct architectural choice here.

The insptrack and carrieranalytics pattern (xs-app.json routes directly to an S/4 OData destination) is valid only when the Fiori app is a pure read/display or simple write-through to an existing S/4 service and no BTP-side business logic is needed. The claims feature does not fit that pattern for these reasons:

It owns a data model with no equivalent in S/4 (VerificationCodes, ClaimFiles, ClaimNotes, ClaimHistory). These entities must live somewhere — a CAP service backed by a persistence store is the right place.
It implements multi-step business logic (email OTP, 4-step form state, file buffering before S/4 upload) that cannot be expressed as an xs-app.json route rule.
It needs a public endpoint (@requires:'any') co-hosted with an authenticated endpoint (@requires:'authenticated-user'). CAP's dual-service pattern with @path separation handles this cleanly.
It writes to S/4 (ClaimsHeaderSet, attachments). Write-through via the approuter destination alone would bypass validation, transformation, and rollback logic.
It needs HANA for persistence durability in production (see Issue 5.2 below).
Conclusion: claims-srv is not over-engineered. It is the minimum viable BTP-side service for this feature set.

Section 2 — insptrack / carrieranalytics direct OData pattern
Is this SAP-recommended? Yes, with caveats.

Routing from an html5-type module's xs-app.json directly to a backend destination is a well-established SAP pattern for Fiori apps hosted in the HTML5 Application Repository and served via the managed approuter (Work Zone). The managed approuter reads the xs-app.json at runtime and applies its routing rules. This avoids the cost and maintenance of a CAP proxy for apps that need no custom BTP-side logic.

The caveats and issues specific to this project are captured in the mta.yaml section below (destination names not in MTA, connectivity service usage).

Section 3 — Approuter choices
insptrack, carrieranalytics, claims — Managed approuter via Work Zone
Correct. SAP's guidance is explicit: use the managed approuter when no approuter extensibility is required. These three apps are standard Fiori apps with no custom routing logic. Using Work Zone's managed approuter reduces operational overhead and is the SAP-recommended default.

claims-form — Standalone approuter
Correct and justified. The managed approuter (Work Zone) requires a Work Zone subscription and handles authentication through its own session management — it is not designed to serve unauthenticated public content. A standalone approuter with authenticationType: none on the relevant routes is the correct pattern here. The claims-form implementation (own approuter.nodejs module, xs-app.json with authenticationType: none for both the static files and the /public/ CAP route) is architecturally sound.

Source: SAP Tech Bytes: FAQ Managed Approuter vs. Standalone Approuter

Section 4 — mta.yaml Issues
Issue 4.1 — forwardAuthToken: true on claims-form's srv-api destination
Why it matters: The /public/ routes use authenticationType: none, so no XSUAA token is generated and forwardAuthToken: true will forward an absent token. The CAP service's PublicClaimsService @requires:'any' accepts this, so it works — but the intent is non-obvious to a reader.

Fix: No structural change needed. Add a comment in mta.yaml explaining why forwardAuthToken is set even though public routes need no authentication.

Issue 4.2 — Connectivity service bound to claims-srv for Internet-only backends (MEDIUM)
Why it matters: The SAP connectivity service is required only for on-premise connectivity through SAP Cloud Connector. The claims-srv backends (S/4HANA via DEV-100-BasicAuthentication and email via nodemailer) are all internet-facing. Binding the connectivity service to claims-srv is unnecessary.

Fix: Remove Container_Inspection_mta-connectivity-service from the requires list of claims-srv. If no other module uses it for on-premise tunnelling, remove the resource entirely.

# claims-srv requires: remove this entry
- name: Container_Inspection_mta-connectivity-service   # REMOVE if no on-premise tunnelling

Source: SAP BTP Connectivity — What is SAP BTP Connectivity?

Issue 4.3 — S/4 destinations not defined in mta.yaml (MEDIUM)
Why it matters: DEV-100-PrincipalPropogation, CROP_SERVICE, and DEV-100-BasicAuthentication are configured manually in the subaccount. A fresh deployment to a new space will fail at runtime (destination not found) without manual intervention. There is no visibility in the MTA of which destinations the application depends on.

Fix (recommended): Add the S/4 destinations to the destination service resource init_data block. Use .mtaext extension files per landscape to supply the real URLs and credentials without committing secrets to git.

# In mta.yaml destination resource init_data:
- Name: S4_PRINCIPAL_PROPAGATION          # use a landscape-neutral name
  Type: HTTP
  ProxyType: Internet
  URL: <placeholder — supply via mtaext>
  Authentication: PrincipalPropagation
  HTML5.ForwardAuthToken: true

# dev.mtaext — kept outside git or in a secrets store
_schema-version: "3.1"
extends: Container_Inspection_mta
resources:
- name: Container_Inspection_mta-destination-service
  parameters:
    config:
      init_data:
        subaccount:
          destinations:
          - Name: S4_PRINCIPAL_PROPAGATION
            URL: https://your-s4-host/
            Authentication: PrincipalPropagation

Source: Defining MTA Extension Descriptors

Issue 4.4 — Destination name DEV-100-PrincipalPropogation has a typo and environment prefix (LOW)
Why it matters: "Propogation" is misspelled (should be "Propagation"). More critically, embedding DEV- in a name referenced in xs-app.json means the xs-app.json encodes environment information — any QA or production deployment requires a code change.

Fix: Rename to a landscape-neutral name (e.g., S4_PRINCIPAL_PROPAGATION) and update all xs-app.json references. Repeat for DEV-100-BasicAuthentication → e.g., S4_CLAIMS_BACKEND.

Issue 4.5 — disk-quota missing for claims-srv (LOW)
Why it matters: SAP best practices say to set disk-quota explicitly so the quota is intentional and visible in the descriptor.

Fix:

- name: claims-srv
  type: nodejs
  parameters:
    buildpack: nodejs_buildpack
    instances: 1
    memory: 512M
    disk-quota: 512M    # add this

Source: List of Supported MTA Parameters

Issue 4.6 — _schema-version: "3.2" (LOW)
Why it matters: Most SAP documentation examples and MBT tooling are tested against 3.1. There is no functional difference for the constructs used here, but 3.1 maximises tool compatibility.

Fix: Change _schema-version: "3.2" to _schema-version: "3.1" unless a 3.2-specific feature is explicitly needed.

Issue 4.7 — No deployed-after ordering between claims-srv and claims-form (MEDIUM)
Why it matters: enable-parallel-deployments: true is set globally. If claims-srv fails to start, claims-form will be configured with a broken srv-url and start anyway.

Fix:

- name: claims-form
  type: approuter.nodejs
  deployed-after:
  - claims-srv

Issue 4.8 — deploy_mode: html5-repo is a no-op legacy parameter (LOW)
Why it matters: This parameter was used by SAP Web IDE generators and has no effect with the MultiApps CLI plugin or MBT. It can cause confusion.

Fix: Remove deploy_mode: html5-repo from the global parameters block.

Section 5 — CAP-specific Issues (package.json / cds config)
Issue 5.1 — @cap-js/sqlite in production dependencies (HIGH)
Why it matters: cds build --production copies package.json into gen/srv. The CF nodejs buildpack installs it on the production container — wasting disk, adding native compilation risk, and signalling to CAP that SQLite is available in production (which can mask missing HANA configuration).

Fix: Move @cap-js/sqlite to devDependencies:

"devDependencies": {
  "@cap-js/sqlite": "^3",
  ...
}

Source: CAP — SQLite

Issue 5.2 — No production database — db: sqlite:memory with no [production] override (CRITICAL)
Why it matters: In production on CF, CDS_ENV=production is set. With no production override, CAP runs against an in-memory SQLite database in production. All claim submissions, verification codes, notes, and history will be lost on every app restart or redeploy. This is a data-loss bug.

Fix: Add an hdi-shared HANA resource to mta.yaml and add the production db config:

// srv/claims/package.json — add inside "cds.requires"
"[production]": {
  "auth": "xsuaa",
  "db": { "kind": "hana" }
}

# mta.yaml — add resource
- name: claims-hdi
  type: org.cloudfoundry.managed-service
  parameters:
    service: hana
    service-plan: hdi-shared
    service-name: Container_Inspection_mta-claims-hdi

# mta.yaml — add to claims-srv requires
- name: claims-hdi

Source: CAP — Deploy to Cloud Foundry

Issue 5.3 — mail.[production].kind = "console" — No real mail transport in production (CRITICAL)
Why it matters: With kind: console, verification codes are written to application logs — not emailed to claimants. The public form's OTP gating is completely broken in production.

Fix: Configure a real SMTP transport. Supply credentials via environment variables, never in package.json.

"mail": {
  "[development]": { "kind": "console", "from": "claims@primes4.local" },
  "[production]": {
    "kind": "smtp",
    "from": "claims@primes4.com",
    "credentials": {
      "host": { "$env": "MAIL_HOST" },
      "port": 587,
      "auth": {
        "user": { "$env": "MAIL_USER" },
        "pass": { "$env": "MAIL_PASS" }
      }
    }
  }
}

Issue 5.4 — DEV-100-BasicAuthentication as the S/4 destination for production (MEDIUM)
Why it matters: Basic Authentication means a shared technical user credential. For a claims service writing to S/4 on behalf of logged-in users, Principal Propagation (or OAuth2SAMLBearerAssertion) is preferred — it preserves the audit trail in S/4. Also, the DEV- prefix encodes the environment in a production config (see Issue 4.4).

Fix: Create a production destination (S4_CLAIMS_BACKEND) using OAuth2SAMLBearerAssertion or Principal Propagation. Update the CAP config:

"claimsBackend": {
  "kind": "local",
  "[production]": {
    "kind": "s4",
    "destination": "S4_CLAIMS_BACKEND"
  }
}

Source: CAP — Remote Services

Section 6 — xs-security.json Issues
Issue 6.1 — Missing redirect-uris in oauth2-configuration (HIGH)
Why it matters: Without redirect-uris, XSUAA will refuse all redirect-based login flows in production. The approuter callback URL must be whitelisted.

Fix:

"oauth2-configuration": {
  "credential-types": ["binding-secret", "x509"],
  "redirect-uris": [
    "https://claims-form-<org>-<space>.<cf-domain>/login/callback",
    "https://*.cfapps.<region>.hana.ondemand.com/**"
  ]
}

Replace the wildcard with exact URLs for production.

Source: Application Security Descriptor Configuration Syntax

Issue 6.2 — Missing role-collections (MEDIUM)
Why it matters: The ClaimsAgent role template exists but no role collection is pre-defined. Administrators must manually create and assign one after every fresh deployment.

Fix:

"role-collections": [
  {
    "name": "ClaimsAgent",
    "description": "Access to the Claims ticket log for claims handling agents",
    "role-template-references": [
      "$XSAPPNAME.ClaimsAgent",
      "$XSAPPNAME.Token_Exchange"
    ]
  }
]

Source: Application Security Descriptor Configuration Syntax

Issue 6.3 — xsappname is not space-unique (LOW)
Why it matters: Deploying to multiple spaces in the same org will create conflicting XSUAA app names.

Fix: Supply xsappname via the XSUAA resource's config block in mta.yaml using ${org}-${space}:

- name: uaa_Container_Inspection_mta
  type: org.cloudfoundry.managed-service
  parameters:
    service: xsuaa
    service-plan: application
    service-name: Container_Inspection_mta-xsuaa-service
    config:
      xsappname: container_inspection_mta-${org}-${space}
      tenant-mode: dedicated

Then either remove xsappname from xs-security.json (the config block takes precedence) or keep it as a fallback for local cds bind.

Issue 6.4 — uaa.user declared as an owned scope (LOW)
Why it matters: uaa.user is a scope owned by the UAA system application. Declaring it in your scopes array is technically incorrect.

Fix: Remove the uaa.user scope and the Token_Exchange role template — these are handled automatically by the standard XSUAA flow. If token exchange is explicitly needed, follow SAP's documentation on foreign scope references with grant-as-authority-to-apps.

Summary
Severity	Issue	File
CRITICAL	No production database — sqlite:memory loses all data on restart	package.json
CRITICAL	mail kind=console in production — OTP emails never sent	package.json
HIGH	@cap-js/sqlite in production dependencies, installed on CF container	package.json
HIGH	Missing redirect-uris — XSUAA authentication will fail	xs-security.json
HIGH	DEV-100-BasicAuthentication: wrong auth type for S/4 write, name encodes env	package.json
MEDIUM	S/4 destinations not in mta.yaml — not reproducible in new spaces	mta.yaml
MEDIUM	Missing role-collections — manual admin step after every fresh deploy	xs-security.json
MEDIUM	Connectivity service bound to claims-srv unnecessarily	mta.yaml
MEDIUM	No deployed-after on claims-form	mta.yaml
MEDIUM	DEV-100-BasicAuthentication used in production claimsBackend config	package.json
LOW	Destination names contain DEV- prefix and typo (Propogation)	xs-app.json / destinations
LOW	xsappname not space-unique	xs-security.json / mta.yaml
LOW	disk-quota not set on claims-srv	mta.yaml
LOW	deploy_mode: html5-repo is a no-op legacy parameter	mta.yaml
LOW	_schema-version 3.2 vs 3.1	mta.yaml
LOW	uaa.user declared as own scope	xs-security.json
Final verdicts
claims-srv: justified or not?

Justified. The claims feature owns its own data model, stateful business logic (OTP, multi-step form, file handling), and writes to S/4. None of this can be done with an xs-app.json route rule. insptrack and carrieranalytics correctly bypass CAP because they are pure Fiori read/write apps on existing S/4 services with no BTP-side logic. claims is a different category of feature — it needs a real backend. A CAP service is the correct and minimum viable solution.

claims-form standalone approuter: correct or not?

Correct and the only viable option. The managed approuter (Work Zone) is not designed to serve unauthenticated public content. A standalone approuter.nodejs module with authenticationType: none on public routes is the SAP-endorsed pattern. The current implementation is architecturally correct.

Sources
SAP BTP — List of Supported MTA Parameters
SAP BTP — Defining MTA Extension Descriptors
SAP BTP — Application Security Descriptor Configuration Syntax (xs-security.json)
SAP BTP — Parameters and Properties
SAP BTP — Sensitive Data Handling During MTA Deployment
SAP BTP — What is SAP BTP Connectivity
SAP Community — FAQ Managed Approuter vs. Standalone Approuter
CAP — Deploy to Cloud Foundry
CAP — SQLite
CAP — Remote Services
BTP Developer's Guide