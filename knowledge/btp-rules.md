# BTP / MTA rule pack (used by the BTP agent)

id: BTP-001
severity: low
applies-to: mta.yaml
rule: Every module should set memory and disk-quota explicitly so quotas are intentional and visible.
bad: - name: srv, type: nodejs (no memory / disk-quota)
good: parameters: { memory: 512M, disk-quota: 512M }
source: https://help.sap.com/docs/btp/sap-business-technology-platform/list-of-supported-mta-parameters

id: BTP-002
severity: medium
applies-to: mta.yaml
rule: Destinations the app depends on should be defined in the destination service resource (init_data), with landscape-specific values supplied through .mtaext, so a new space deploys without manual steps.
bad: destinations configured manually in the subaccount only
good: init_data destinations plus dev.mtaext holding the real URL
source: https://help.sap.com/docs/btp/sap-business-technology-platform/defining-mta-extension-descriptors

id: BTP-003
severity: medium
applies-to: mta.yaml
rule: The connectivity service is only needed for on-premise access via Cloud Connector. Do not bind it for internet-only backends.
bad: requires the connectivity service while all backends are https internet
good: remove the requires entry and the resource if nothing else uses it
source: https://help.sap.com/docs/btp/sap-business-technology-platform/development-in-cloud-foundry-environment

id: BTP-004
severity: medium
applies-to: mta.yaml
rule: With enable-parallel-deployments, a module that depends on another (approuter on srv) should declare deployed-after.
bad: approuter may start before srv is up
good: deployed-after: [ srv ]
source: https://help.sap.com/docs/btp/sap-business-technology-platform/list-of-supported-mta-parameters

id: BTP-005
severity: low
applies-to: mta.yaml
rule: Do not use legacy or no-op global parameters (e.g. deploy_mode: html5-repo). Prefer _schema-version 3.1 unless a 3.2 feature is used.
bad: deploy_mode: html5-repo
good: remove it
source: https://help.sap.com/docs/btp/sap-business-technology-platform/list-of-supported-mta-parameters

id: BTP-006
severity: high
applies-to: mta.yaml
rule: A CAP service that uses HANA needs an hdi-shared (service: hana) resource and it must be listed in the srv module's requires.
bad: srv requires only the xsuaa service
good: requires: [ myapp-db ] with service: hana, service-plan: hdi-shared
source: https://cap.cloud.sap/docs/guides/deploy/to-cf.md

id: BTP-007
severity: high
applies-to: xs-security.json
rule: oauth2-configuration needs redirect-uris for the approuter login callback, with exact URLs in production (no broad wildcards).
bad: no redirect-uris
good: "redirect-uris": ["https://myapp.<domain>/login/callback"]
source: https://help.sap.com/docs/btp/sap-business-technology-platform/application-security-descriptor-configuration-syntax

id: BTP-008
severity: medium
applies-to: xs-security.json
rule: Define role-collections for the role templates so admins do not have to create them after every deploy.
bad: role-templates only
good: "role-collections": [ { "name": "Agent", "role-template-references": ["$XSAPPNAME.Agent"] } ]
source: https://help.sap.com/docs/btp/sap-business-technology-platform/application-security-descriptor-configuration-syntax

id: BTP-009
severity: low
applies-to: xs-security.json, mta.yaml
rule: xsappname should be unique per space (use ${org}-${space} in the xsuaa config) when deploying to several spaces in one org.
bad: fixed xsappname
good: xsappname: myapp-${org}-${space}
source: https://help.sap.com/docs/btp/sap-business-technology-platform/application-security-descriptor-configuration-syntax

id: BTP-010
severity: low
applies-to: xs-security.json
rule: Do not declare platform-owned scopes (e.g. uaa.user) as your own scope.
bad: "scopes": [{ "name": "uaa.user" }]
good: remove it
source: https://help.sap.com/docs/btp/sap-business-technology-platform/application-security-descriptor-configuration-syntax

id: BTP-011
severity: medium
applies-to: xs-app.json
rule: Routes with authenticationType none must be intentional and limited to the public path. Destination names in routes must not encode the environment (DEV-, QA-).
bad: { "source": "^/(.*)", "authenticationType": "none" } for everything
good: only the public path uses "none"
source: https://help.sap.com/docs/btp/sap-business-technology-platform/development-in-cloud-foundry-environment

id: BTP-012
severity: high
applies-to: mta.yaml, xs-app.json, *.mtaext
rule: No secrets (passwords, client secrets, keys) in descriptors committed to git. Supply them at deploy time via bindings, env or an mtaext kept outside git.
bad: password: "abc123" in mta.yaml
good: secret supplied at deploy time
source: https://help.sap.com/docs/btp/sap-business-technology-platform/parameters-and-properties
