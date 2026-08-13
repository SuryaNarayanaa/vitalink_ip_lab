let meta = #{
    name: "review-and-fix-app",
    description: "Review VitaLink for logical, UI, backend, and integration issues; apply only adversarially verified fixes",
    when_to_use: "Use after implementing features when frontend, backend, or docs may have drifted: find logical errors, UI mismatches, API inconsistencies, and integration bugs, then apply only verified safe fixes.",
    phases: [
        #{ title: "Inventory", detail: "map routes, APIs, and known mismatch surfaces" },
        #{ title: "Review", detail: "one reviewer per consistency dimension" },
        #{ title: "Verify", detail: "one skeptic per candidate finding" },
        #{ title: "Apply", detail: "implement only confirmed safe fixes" },
        #{ title: "Confirm", detail: "re-read diffs and check for regressions" },
    ],
};

let inventory_schema = #{
    "type": "object",
    "required": ["summary", "surfaces"],
    "properties": #{
        "summary": #{ "type": "string" },
        "surfaces": #{
            "type": "array",
            "maxItems": 24,
            "items": #{ "type": "string" },
        },
    },
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["id", "file", "issue", "category", "severity", "expected", "actual"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "category": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "expected": #{ "type": "string" },
                    "actual": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence", "safe_to_fix"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
        "safe_to_fix": #{ "type": "boolean" },
    },
};

let apply_schema = #{
    "type": "object",
    "required": ["applied", "skipped", "notes", "docs_updated"],
    "properties": #{
        "applied": #{ "type": "array", "items": #{ "type": "string" } },
        "skipped": #{ "type": "array", "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
        "docs_updated": #{ "type": "boolean" },
    },
};

let confirm_schema = #{
    "type": "object",
    "required": ["ok", "regressions", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "regressions": #{ "type": "array", "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
    },
};

fn trimmed(s) {
    if type_of(s) == "string" {
        s.trim();
        s
    } else {
        ""
    }
}

fn starts_with(s, prefix) {
    if type_of(s) != "string" || type_of(prefix) != "string" {
        return false;
    }
    if prefix.len() == 0 {
        return true;
    }
    if s.len() < prefix.len() {
        return false;
    }
    s.sub_string(0, prefix.len()) == prefix
}

fn normalize_path(path) {
    let p = trimmed(path);
    if p == "" {
        return "";
    }
    let out = "";
    let i = 0;
    while i < p.len() {
        let ch = p.sub_string(i, 1);
        if ch == "\\" {
            out += "/";
        } else {
            out += ch;
        }
        i += 1;
    }
    out
}

fn repo_rel(path) {
    let p = normalize_path(path);
    if p == "" {
        return "";
    }
    let marker = "vitalink_ip_lab/";
    let idx = -1;
    let i = 0;
    let last = p.len();
    if last >= marker.len() {
        last = p.len() - marker.len() + 1;
    } else {
        last = 0;
    }
    while i < last {
        if p.sub_string(i, marker.len()) == marker {
            idx = i;
        }
        i += 1;
    }
    if idx >= 0 {
        return p.sub_string(idx + marker.len(), p.len() - idx - marker.len());
    }
    p
}

fn path_contains(path, needle) {
    let p = normalize_path(path);
    let n = trimmed(needle);
    if p == "" || n == "" {
        return false;
    }
    if p.len() < n.len() {
        return false;
    }
    let i = 0;
    let last = p.len() - n.len() + 1;
    while i < last {
        if p.sub_string(i, n.len()) == n {
            return true;
        }
        i += 1;
    }
    false
}

fn allowed_file(path) {
    let p = repo_rel(path);
    if p == "" {
        return false;
    }
    if path_contains(p, "node_modules") {
        return false;
    }
    if path_contains(p, "/build/") {
        return false;
    }
    if starts_with(p, "build/") {
        return false;
    }
    if starts_with(p, "site/") {
        return false;
    }
    if starts_with(p, "frontend/lib/") {
        return true;
    }
    if starts_with(p, "frontend/test/") {
        return true;
    }
    if starts_with(p, "backend/src/") {
        return true;
    }
    if starts_with(p, "backend/tests/") {
        return true;
    }
    if starts_with(p, "docs/") {
        return true;
    }
    if starts_with(p, "backend/docs/") {
        return true;
    }
    false
}

fn finding_key(item) {
    let file = "";
    let issue = "";
    if item.file != () {
        file = repo_rel(item.file);
    }
    if item.issue != () {
        issue = trimmed(item.issue);
    }
    file + " | " + issue
}

fn text_has(hay, needle) {
    let h = trimmed(hay);
    let n = trimmed(needle);
    if n == "" {
        return true;
    }
    if h.len() < n.len() {
        return false;
    }
    let i = 0;
    let last = h.len() - n.len() + 1;
    while i < last {
        if h.sub_string(i, n.len()) == n {
            return true;
        }
        i += 1;
    }
    false
}

let mode_name = "fix";
let focus = "";
let max_keep = 16;
if args != () {
    if args.mode != () {
        mode_name = trimmed(args.mode);
    }
    if args.focus != () {
        focus = trimmed(args.focus);
    }
    if args.max_findings != () {
        if type_of(args.max_findings) == "i64" || type_of(args.max_findings) == "f64" {
            max_keep = args.max_findings;
        }
    }
}
if mode_name != "review" && mode_name != "fix" {
    pause("verification", "Pass args.mode as \"review\" or \"fix\".");
}
if max_keep < 4 {
    max_keep = 4;
}
if max_keep > 24 {
    max_keep = 24;
}

log("Starting review-and-fix-app mode=" + mode_name + " max_findings=" + max_keep.to_string());

phase("Inventory");
let inventory_prompt = "";
inventory_prompt += "You are inventorying the VitaLink repository at the workspace root. ";
inventory_prompt += "Use read-only tools (read_file, grep, list_dir) — do not answer from memory. ";
inventory_prompt += "Read at least: frontend/lib/app/routers.dart, frontend/lib/core/network/api_client.dart, ";
inventory_prompt += "frontend/lib/features/login/data/auth_repository.dart, backend/src/routes/index.ts, ";
inventory_prompt += "backend/src/routes/auth.routes.ts, backend/src/routes/patient.routes.ts, ";
inventory_prompt += "backend/src/routes/doctor.routes.ts, backend/src/routes/admin.routes.ts, ";
inventory_prompt += "docs/api/openapi.yaml (or backend/docs/api/openapi.yaml), ";
inventory_prompt += "docs/workflows/end-to-end.md, docs/reference/inconsistencies.md, and docs/product/overview.md. ";
inventory_prompt += "Summarize the live patient, doctor, admin, and auth surfaces that a consistency review must cover. ";
inventory_prompt += "List concrete file paths under frontend/lib, backend/src, and docs. ";
inventory_prompt += "Note already-documented INC-* items so reviewers can confirm whether they are still present in code. ";
inventory_prompt += "Do not invent product features. An empty surfaces list is valid only after you have read those files. ";
if focus != "" {
    inventory_prompt += "Caller focus hint: " + json_encode(focus) + ". Prefer surfaces related to that hint, but still mention auth and API contract files if they intersect.";
}

let inventory = agent(inventory_prompt, #{
    label: "inventory",
    capability_mode: "read-only",
    output_schema: inventory_schema,
});

let scope_summary = "Review frontend/lib, backend/src, backend/tests, frontend/test, docs/api, and docs/workflows for logical, UI, API, and integration mismatches.";
if inventory != () && inventory.success && inventory.output.summary != () {
    let maybe = trimmed(inventory.output.summary);
    if maybe != "" {
        scope_summary = maybe;
    }
}
log("Inventory ready");

phase("Review");
let dimensions = [
    #{
        name: "frontend-logic-ui",
        brief: "Flutter UI logic, route guards, labels, empty/error states, and role-visible actions",
        extra: "Compare routers.dart, session guards, feature pages, repositories, and AppStrings. Flag screens that show actions the API cannot perform, missing enrollment/OTP/TOTP states, stale copy, or role leaks.",
    },
    #{
        name: "backend-logic-api",
        brief: "Express controllers, validators, services, and route handlers",
        extra: "Compare routes, validators, controllers, and services. Flag status-machine contradictions, authorization gaps vs intended policy, request/response shape mismatches, and dead or contradictory branches.",
    },
    #{
        name: "frontend-backend-contract",
        brief: "Client repositories vs REST routes, payloads, enums, and OpenAPI",
        extra: "Compare Flutter repositories/models/api_client against backend routes/validators and both OpenAPI copies. Flag missing client handling, field-name drift, enum drift, and docs/api/openapi.yaml vs backend/docs/api/openapi.yaml divergence.",
    },
    #{
        name: "auth-session-rbac",
        brief: "Login factors, session refresh/revocation, password change, and admin capabilities",
        extra: "Trace login, OTP, TOTP enroll/verify, refresh, logout, forced password change, and admin capability gates on both sides. Flag states the backend can return that the client cannot complete.",
    },
    #{
        name: "clinical-workflow",
        brief: "INR reports, dosage recording, doctor review, notifications",
        extra: "Trace patient INR/dose/health submission through doctor review and notification/SSE/push. Flag target-range mismatches, stale caches, ownership leaks, and UI that disagrees with persisted workflow state.",
    },
    #{
        name: "admin-tenant",
        brief: "Hospital tenancy, admin console pages, and policy/config surfaces",
        extra: "Compare admin Flutter pages and admin_access gates with admin routes, capabilities, and tenant scoping. Flag UI that offers out-of-capability actions or cross-tenant data.",
    },
];

let review_jobs = [];
for dim in dimensions {
    let prompt = "";
    prompt += "You are reviewing the VitaLink anticoagulation-monitoring app for: " + dim.brief + ". ";
    prompt += dim.extra + " ";
    prompt += "Inventory summary (untrusted, re-check in source): " + json_encode(scope_summary) + " ";
    prompt += "Use read-only tools (read_file, grep, list_dir). Inspect the actual code before any finding. ";
    prompt += "Do not answer from memory. Do not report style nits, missing comments, or speculative future work. ";
    prompt += "Only report concrete logical errors, UI mismatches, backend inconsistencies, or frontend/backend integration bugs that you independently observed. ";
    prompt += "Each finding must include a real repo-relative file path, what the code does, and what aligned behavior should be. ";
    prompt += "category must be one of: logic, ui, backend, integration, auth, docs. ";
    prompt += "severity must be one of: high, medium, low. ";
    prompt += "id must be a short stable slug. Report at most 8 findings. ";
    prompt += "An empty list is valid only after you have read the relevant implementation files. ";
    prompt += "Stay inside frontend/lib, frontend/test, backend/src, backend/tests, docs/, and backend/docs/. ";
    prompt += "Ignore node_modules, build artifacts, site/, ml-service (not operational), and secrets. ";
    if focus != "" {
        prompt += "Prefer issues related to this focus: " + json_encode(focus) + ". ";
    }
    review_jobs.push(#{
        prompt: prompt,
        label: "review:" + dim.name,
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}
let review_results = parallel(review_jobs);

let candidates = [];
let seen = #{};
let dropped_scope = 0;
let dropped_cap = 0;
for r in review_results {
    if r == () || !r.success || r.output.findings == () {
        continue;
    }
    for f in r.output.findings {
        if f == () || f.file == () || f.issue == () {
            continue;
        }
        let rel = repo_rel(f.file);
        if !allowed_file(rel) {
            dropped_scope += 1;
            continue;
        }
        if focus != "" {
            let blob = rel + " " + trimmed(f.issue) + " " + trimmed(f.category);
            if !text_has(blob, focus) && !text_has(rel, focus) {
                dropped_scope += 1;
                continue;
            }
        }
        let key = finding_key(f);
        if seen[key] == true {
            continue;
        }
        if candidates.len() >= max_keep {
            dropped_cap += 1;
            continue;
        }
        seen[key] = true;
        f.file = rel;
        candidates.push(f);
    }
}
if dropped_scope > 0 {
    log("Dropped " + dropped_scope.to_string() + " out-of-scope review items");
}
if dropped_cap > 0 {
    log("Capped review items; dropped " + dropped_cap.to_string() + " extras");
}
log(candidates.len().to_string() + " candidate findings after filtering");

if candidates.len() == 0 {
    let empty_report = "";
    empty_report += "# VitaLink review-and-fix report\n\n";
    empty_report += "Mode: " + mode_name + "\n\n";
    empty_report += "No in-scope candidate findings survived the review filter. ";
    empty_report += "That is valid only if reviewers inspected the code and found no concrete mismatches.\n\n";
    empty_report += "Inventory:\n\n";
    empty_report += scope_summary;
    empty_report += "\n";
    let empty_path = write_scratch_file("report.md", empty_report);
    complete(#{
        path: empty_path,
        report: empty_report,
        summary: "No in-scope findings.",
        confirmed: [],
        applied: [],
    });
}

phase("Verify");
let verify_jobs = [];
let vi = 0;
for f in candidates {
    let vprompt = "";
    vprompt += "Adversarially verify this VitaLink review finding. Default real=false and safe_to_fix=false. ";
    vprompt += "Use read-only tools (read_file, grep) and inspect the shipped code yourself. ";
    vprompt += "Set real=true only with concrete evidence you independently read. ";
    vprompt += "Set safe_to_fix=true only if a small, localized change can align frontend and backend without new product features, without weakening auth/tenant checks, and without breaking existing flows. ";
    vprompt += "If the issue is only documented as a known INC-* operational gap (deploy/monitoring/ML non-goals) and is not a live client/server logic bug, set real=false. ";
    vprompt += "Finding id: " + json_encode(f.id) + ". ";
    vprompt += "File: " + json_encode(f.file) + ". ";
    vprompt += "Category: " + json_encode(f.category) + ". ";
    vprompt += "Issue: " + json_encode(f.issue) + ". ";
    vprompt += "Claimed expected: " + json_encode(f.expected) + ". ";
    vprompt += "Claimed actual: " + json_encode(f.actual) + ". ";
    vprompt += "evidence must quote file paths and the behavior you observed.";
    verify_jobs.push(#{
        prompt: vprompt,
        label: "verify:" + vi.to_string(),
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
    vi += 1;
}
let verdicts = parallel(verify_jobs);

let confirmed = [];
let rejected = [];
let i = 0;
for v in verdicts {
    let item = candidates[i];
    let accepted = false;
    if v != () && v.success && v.output.real == true && v.output.safe_to_fix == true {
        if v.output.evidence != () && trimmed(v.output.evidence) != "" {
            accepted = true;
        }
    }
    if accepted {
        if v.output.reason != () {
            item.verify_reason = v.output.reason;
        }
        if v.output.evidence != () {
            item.verify_evidence = v.output.evidence;
        }
        confirmed.push(item);
    } else {
        rejected.push(item);
    }
    i += 1;
}
log(confirmed.len().to_string() + "/" + candidates.len().to_string() + " findings confirmed as real and safe to fix");

let applied_ids = [];
let skipped_ids = [];
let apply_notes = "Apply phase not run.";
let docs_updated = false;
let confirm_ok = true;
let confirm_summary = "No code changes.";
let regressions = [];

if mode_name == "fix" && confirmed.len() > 0 {
    phase("Apply");
    let apply_prompt = "";
    apply_prompt += "You are applying verified VitaLink fixes in the current workspace (not an isolated worktree). ";
    apply_prompt += "Inspect the current files with read_file/grep before editing. Implement only the confirmed findings below. ";
    apply_prompt += "Do not invent features. Do not weaken authentication, authorization, tenant isolation, or validation. ";
    apply_prompt += "Do not touch secrets, keystores, node_modules, build/, site/, or unrelated files. ";
    apply_prompt += "Keep frontend and backend behavior aligned: if you change a payload, enum, route, or status, update the client, the server, and both OpenAPI copies so docs/api/openapi.yaml and backend/docs/api/openapi.yaml stay byte-for-byte identical. ";
    apply_prompt += "Follow Agents.md: update affected docs in the same change; do not present assumptions as implemented; record remaining uncertainty in docs/reference/open-questions.md. ";
    apply_prompt += "If a finding cannot be fixed safely without a product decision, skip it and explain why. ";
    apply_prompt += "Preserve existing functionality. Add or update focused tests when you change logic. ";
    apply_prompt += "Return applied as finding ids you actually edited for, skipped as ids you did not change. ";
    apply_prompt += "Confirmed findings JSON: " + json_encode(confirmed);
    let apply_result = agent(apply_prompt, #{
        label: "apply-fixes",
        capability_mode: "all",
        output_schema: apply_schema,
    });
    if apply_result != () && apply_result.success && apply_result.output.applied != () {
        applied_ids = apply_result.output.applied;
        if apply_result.output.skipped != () {
            skipped_ids = apply_result.output.skipped;
        }
        if apply_result.output.notes != () {
            apply_notes = apply_result.output.notes;
        }
        if apply_result.output.docs_updated == true {
            docs_updated = true;
        }
    } else {
        apply_notes = "Apply agent failed or returned unusable output; no successful apply was recorded.";
        confirm_ok = false;
    }

    phase("Confirm");
    let confirm_prompt = "";
    confirm_prompt += "Re-read the VitaLink files that should have changed for these applied finding ids: ";
    confirm_prompt += json_encode(applied_ids) + ". ";
    confirm_prompt += "Confirmed findings: " + json_encode(confirmed) + ". ";
    confirm_prompt += "Apply notes: " + json_encode(apply_notes) + ". ";
    confirm_prompt += "Use read_file/grep and, if practical, run the most relevant existing tests ";
    confirm_prompt += "(backend Jest tests under backend/tests for touched server files; Flutter tests under frontend/test for touched client files). ";
    confirm_prompt += "Do not run broad unrelated suites if a targeted test exists. ";
    confirm_prompt += "Set ok=true only if each applied fix is present in source and you found no clear regression in neighboring flows. ";
    confirm_prompt += "List any remaining mismatch or broken adjacent behavior in regressions. ";
    confirm_prompt += "If applied is empty, set ok=true only when skipping was justified.";
    let confirm_result = agent(confirm_prompt, #{
        label: "confirm-fixes",
        capability_mode: "execute",
        output_schema: confirm_schema,
    });
    if confirm_result != () && confirm_result.success && confirm_result.output.summary != () {
        confirm_summary = confirm_result.output.summary;
        if confirm_result.output.ok == false {
            confirm_ok = false;
        }
        if confirm_result.output.regressions != () {
            regressions = confirm_result.output.regressions;
        }
    } else {
        confirm_ok = false;
        confirm_summary = "Confirm agent failed or returned unusable output.";
    }
} else {
    log("Skipping apply (mode=" + mode_name + ", confirmed=" + confirmed.len().to_string() + ")");
}

let report = "";
report += "# VitaLink review-and-fix report\n\n";
report += "Mode: `" + mode_name + "`\n\n";
if focus != "" {
    report += "Focus: `" + focus + "`\n\n";
}
report += "Inventory:\n\n";
report += scope_summary;
report += "\n\n";
report += "Candidates: " + candidates.len().to_string() + ". ";
report += "Confirmed safe to fix: " + confirmed.len().to_string() + ". ";
report += "Rejected or unverified: " + rejected.len().to_string() + ".\n\n";

report += "## Confirmed findings\n\n";
if confirmed.len() == 0 {
    report += "None.\n\n";
} else {
    for f in confirmed {
        report += "### " + trimmed(f.id) + " (" + trimmed(f.severity) + " / " + trimmed(f.category) + ")\n\n";
        report += "- File: `" + trimmed(f.file) + "`\n";
        report += "- Issue: " + trimmed(f.issue) + "\n";
        report += "- Expected: " + trimmed(f.expected) + "\n";
        report += "- Actual: " + trimmed(f.actual) + "\n";
        if f.verify_evidence != () {
            report += "- Evidence: " + trimmed(f.verify_evidence) + "\n";
        }
        report += "\n";
    }
}

report += "## Rejected or unverified\n\n";
if rejected.len() == 0 {
    report += "None.\n\n";
} else {
    for f in rejected {
        report += "- `" + trimmed(f.id) + "` in `" + trimmed(f.file) + "`: " + trimmed(f.issue) + "\n";
    }
    report += "\n";
}

if mode_name == "fix" {
    report += "## Apply\n\n";
    report += apply_notes;
    report += "\n\nApplied ids: " + json_encode(applied_ids) + "\n\n";
    report += "Skipped ids: " + json_encode(skipped_ids) + "\n\n";
    report += "Docs updated: " + docs_updated.to_string() + "\n\n";
    report += "## Confirm\n\n";
    report += confirm_summary;
    report += "\n\n";
    if regressions.len() > 0 {
        report += "Regressions:\n";
        for g in regressions {
            report += "- " + trimmed(g) + "\n";
        }
        report += "\n";
    }
}

let report_path = write_scratch_file("report.md", report);
let summary = confirmed.len().to_string() + " confirmed findings";
if mode_name == "fix" {
    summary += "; applied " + applied_ids.len().to_string();
    if !confirm_ok {
        summary += "; confirm reported problems";
    }
}
complete(#{
    path: report_path,
    report: report,
    summary: summary,
    confirmed_count: confirmed.len(),
    applied: applied_ids,
    skipped: skipped_ids,
    confirm_ok: confirm_ok,
});
