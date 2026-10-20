
# Proper: Entity-Centric CDC & Zero-Trust Ledger

Proper is an entity-centric, memory-safe Change Data Capture (CDC) and auditing engine built in Go. Its core purpose is to monitor your database entities, guarantee that all downstream distributed systems remain perfectly synchronized with your primary state, and maintain a definitive, zero-trust ledger of every lifecycle event.

Unlike standard integration tools that blindly pipe raw database rows through third-party servers, Proper treats every database change as a cryptographically secure entity event. It evaluates, transforms, and encrypts database logs natively at the edge (within your VPC), writing to a secure local audit log while safely dispatching state changes to external systems.

## Core Capabilities

- **The Entity Lifecycle Ledger:** Maintains a strictly append-only, zero-trust audit log of all entity state changes. In Cloud-Managed Mode, Proper Cloud secures this as a cryptographically immutable ledger. In Local Install Mode, it acts as a highly resilient, append-only local audit log. Both guarantee proof of data synchronization across distributed architectures for strict compliance requirements (CCPA, GDPR, California Delete Act).

- **Centralized Architecture & Single Source of Truth:** Extract entity state tracking, webhook dispatches, and sync logic out of your application code. Instead of scattering hidden side-effects across dozens of API routes, microservices, or monolithic background workers, Proper centralizes your entire event-driven architecture into a single, declarative Data Contract (`proper.config.yaml`). 

- **Zero-Trust Security (Field-Level E2EE):** You retain complete control over data visibility. Flag highly sensitive properties (like PII) in your entity schema to be AES-256-GCM encrypted at the edge using your own environment-level encryption key (`PROPER_ENCRYPT_KEY`). Proper Cloud never receives or inspects the plaintext of these secured fields.

- **Zero-Knowledge Compliance Search:** Locate specific entity records across your entire encrypted ledger instantly. Proper generates secure blind indexes (HMAC-SHA256) at the edge, allowing your Data Protection Officer (DPO) to search for specific records (like a CCPA deletion request email) without ever exposing plaintext data to the cloud.

- **Human-in-the-Loop Quarantine *(Pro & Enterprise)*:** Flag highly sensitive entity triggers to be securely halted at the edge in a local escrow queue (`.enc`). These payloads remain encrypted on your infrastructure and will only execute over the wire once an authorized admin explicitly approves the release via the Proper Cloud dashboard.

- **Client-Side Vault Decryption:** DPOs access the Proper Cloud React Dashboard using the Web Crypto API. By providing their local vault key in the browser, ciphertexts and context strings are decrypted entirely in-memory. The encryption key never leaves the client, ensuring mathematical Zero-Trust integrity.

- **Deep JSON Traversal & Fallbacks:** Constructs dynamic sync payloads with chained logical fallbacks (`{{after.name || 'No Name'}}`) and parses nested structures natively.

## Operational Modes: Cloud-Managed vs. Local Install

Proper operates in a hybrid deployment model, adapting automatically based on your environment variables.

### Cloud-Managed Mode (Enterprise/SaaS)

Activated when `PROPER_API_KEY` is present in your environment.

- **`pipeline_id` in YAML is disregarded:** The pipeline ID is authoritatively provisioned by and synced from Proper Cloud.
- **`PROPER_SECRET` in `.env` is securely overridden:** Proper Cloud securely manages and distributes the pipeline's HMAC blind indexing secret to ensure search parity across the Proper Cloud dashboard. If a local secret is detected, the engine gracefully ignores it and prints a warning.

### Local Install Mode (Open-Source)

Activated when `PROPER_API_KEY` is absent.

- **`pipeline_id` is required in YAML:** Acts as your local workspace namespace.
- **`PROPER_SECRET` is required in `.env`:** Must be supplied locally to salt and compute the HMAC-SHA256 blind indexes written to the local log.

## Installation & Initialization

Proper is distributed as a single, statically compiled binary with flat memory allocation (`O(1)` RAM). 

```bash
# Homebrew (macOS / Linux)
brew install @onproper/tap/cli

# NPM / NPX (Node Environments)
npm install -g @onproper/cli

# Docker
docker pull @onproper/cli:latest

```

Initialize a new workspace to generate your `.proper` data directory, `.env` template, and `proper.config.yaml` skeleton:

```bash
proper init

```

## Configuration (The Data Contract)

Proper operates on a strict Data Contract defined in `proper.config.yaml`.

### 1. Environment Variables (`.env`)

```env
DATABASE_URL=postgres://user:password@localhost:5432/dbname
PROPER_API_KEY=prp_live_your_secret_key        # Cloud only
PROPER_SECRET=your_hmac_blind_index_secret     # Local Install only
PROPER_ENCRYPT_KEY=your_aes_256_encryption_key # Used for Field-Level E2EE & Quarantine

```

### 2. Defining Entities & Guardrails

Entities define the schema of the tables you capture. Proper enforces strict architectural invariants at boot time:

* **Searchable Encryption:** A field CAN be both `encrypt: true` and `index: true`. The engine replaces the payload value with AES-GCM ciphertext while securely appending a deterministic HMAC hash to the `_links` array for cloud searchability.
* **Relational Key Protection:** Fields marked `primary_key` or `foreign_key` cannot be encrypted to protect relational graphs.
* **Anti-Bloat Index Caps:** An entity can define a maximum of **5 indexed fields** to maintain predictable query performance.

```yaml
pipeline_id: "pipe_12345"
max_concurrency: 100

entities:
  - entity: "users"
    primary_key: "id"
    properties:
      - field: "id"
        type: "string"
      - field: "email"
        type: "string"
        encrypt: true  # 🔒 Replaced with __proper_enc__:<ciphertext> in the payload
        index: true    # 🔍 Pushed to the _links array as an HMAC hash
      - field: "password_hash"
        type: "string"
        log: false     # ❌ Dropped completely. Never recorded in the audit ledger.

```

### 3. Triggers, Context & Dispatch

Triggers securely dispatch webhooks when entity state changes.

The `dispatch.context` string provides a human-readable explanation of the mechanical webhook request for your DPO. Proper's compiler natively intercepts this string to **enforce Zero-Trust rules**, encrypting sensitive PII tags and redacting server environment variables before they ever reach the cloud ledger.

```yaml
triggers:
  - id: "sync_customer_profile"
    entity: "users"
    action: "UPDATE"
    require_approval: true # ⏸️ Halts webhook locally in quarantine queue
    dispatch:
      target: "[https://api.crm.com/v1/contacts](https://api.crm.com/v1/contacts)"
      method: "POST"
      headers:
        "Authorization": "Bearer ${STRIPE_API_KEY}" # 🔓 Real secret sent over the wire
      
      # 🟢 Human-readable metadata for the Proper Cloud UI / DPO
      # Cloud receives: "Updated __proper_enc__:abc123... using [REDACTED: STRIPE_API_KEY]"
      context: "Updated {{after.email}} using ${STRIPE_API_KEY}" 
      
      merge_data: true 
      data:
        - field: "display_name"
          value: "{{after.first_name || before.first_name || 'Valued Customer'}}"

```

### 4. Advanced Condition Logic & Historic Diffing

Group conditions using `AND`/`OR` logic and diff against previous states using `historic: true`.

```yaml
triggers:
  - id: "flag_critical_balance_drop"
    entity: "accounts"
    action: "UPDATE"
    logic: "AND"
    conditions:
      # Group A: Current state check
      - group: "account_status"
        field: "is_active"
        operator: "=="
        value: "true"

      # Group B: Diff against the pre-update state
      - group: "balance_change"
        field: "balance"
        historic: true # Pulls from the OldRow (before update)
        operator: ">"
        value: "1000.00"

```

## Developer CLI Suite

The Proper binary includes built-in operational tooling for local development and observability.

### Engine Operations

```bash
# Validate your Data Contract schema and environment variables
proper validate

# Boot the CDC streaming engine
proper start

# Boot with live plaintext payload debugging printed to stdout
proper start --debug

```

### Zero-Knowledge Local Search

Locate entity records in the local append-only audit log (`.proper/data/proper.audit.log`) using blind indexes without decrypting the entire file to disk.

```bash
# Search by exact plaintext value (hashed JIT via PROPER_SECRET)
proper lookup --value="compliance@enterprise.com"

# Filter by entity, trigger, or HTTP status code
proper lookup --value="user_01H7X" --entity="users" --status_code=200

```

### Kubernetes / Health Probes

When the engine is running, a lightweight liveness multiplexer is exposed on port `9090` (customizable via `PROPER_HEALTH_PORT`).

```bash
curl http://localhost:9090/healthz
# Expected Response: {"status":"alive","cdc":"connected"}

```

```

```