#!/usr/bin/env bash
# =============================================================================
# Unit tests for deploy/deploy.sh -> validate_production_env()
#
# There is no shell test framework (e.g. bats) wired into this repository, so
# this is a small, self-contained, dependency-free test runner. It sources
# deploy.sh (with the harmless "status" action so the script's top-level
# dispatch does not perform any real deployment work) to pull in the
# validate_production_env() function, then exercises it directly against a
# collection of temporary ".env.production" fixtures.
#
# Run with:  bash deploy/deploy.test.sh
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SH="$SCRIPT_DIR/deploy.sh"

TESTS_RUN=0
TESTS_FAILED=0

pass() {
    TESTS_RUN=$((TESTS_RUN + 1))
    echo "  ok - $1"
}

fail() {
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  NOT OK - $1"
}

# Portable replacement for `printf 'x%.0s' $(seq 1 N)` (avoids depending on
# the external `seq` binary, which is not guaranteed to be installed).
repeat_char() {
    local char="$1" count="$2" result=""
    local i
    for ((i = 0; i < count; i++)); do
        result+="$char"
    done
    printf '%s' "$result"
}

# docker isn't relevant to validate_production_env, but deploy.sh's bottom-of
# file dispatch runs status() -> `docker ps ...` as a side effect of sourcing
# with the "status" action. Stub it out so tests don't depend on a real
# docker installation and don't touch the host's docker daemon.
docker() { :; }

# Source deploy.sh with the "status" action. status() never calls exit, so
# sourcing completes normally and leaves validate_production_env (along with
# log/warn/err) defined as functions in this shell for direct testing.
source "$DEPLOY_SH" status >/dev/null 2>&1

# deploy.sh enables `set -euo pipefail`, which leaks into this shell once
# sourced. Undo that here so a failing (non-zero) assertion inside this test
# runner doesn't abort the whole suite early.
set +e
set +o pipefail

# Sanity check: sourcing must have actually defined the function under test.
if ! declare -F validate_production_env >/dev/null; then
    echo "FATAL: validate_production_env() was not defined after sourcing $DEPLOY_SH" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Runs validate_production_env in a subshell against a given fixture
# directory (used as DEPLOY_DIR), so that the function's `exit` calls only
# terminate the subshell rather than this test runner.
run_validate() {
    local fixture_dir="$1"
    (
        DEPLOY_DIR="$fixture_dir"
        validate_production_env
    ) >/tmp/deploy_test_stdout.$$ 2>/tmp/deploy_test_stderr.$$
    return $?
}

make_fixture() {
    local dir
    dir="$(mktemp -d)"
    echo "$dir"
}

cleanup_fixture() {
    rm -rf "$1"
    rm -f /tmp/deploy_test_stdout.$$ /tmp/deploy_test_stderr.$$
}

stderr_contains() {
    grep -qF "$1" "/tmp/deploy_test_stderr.$$"
}

# ---------------------------------------------------------------------------
# Test: missing .env.production file
# ---------------------------------------------------------------------------
test_missing_env_file() {
    local dir exit_code
    dir="$(make_fixture)"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 1 ]] && stderr_contains ".env.production not found"; then
        pass "missing .env.production exits 1 with a clear error"
    else
        fail "missing .env.production exits 1 with a clear error (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: empty / missing JWT_SECRET value
# ---------------------------------------------------------------------------
test_missing_jwt_secret() {
    local dir exit_code
    dir="$(make_fixture)"
    printf 'NODE_ENV=production\nJWT_SECRET=\n' > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 1 ]] && stderr_contains "JWT_SECRET is missing or empty"; then
        pass "empty JWT_SECRET exits 1 with a clear error"
    else
        fail "empty JWT_SECRET exits 1 with a clear error (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

test_jwt_secret_key_absent_entirely() {
    local dir exit_code
    dir="$(make_fixture)"
    printf 'NODE_ENV=production\n' > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 1 ]] && stderr_contains "JWT_SECRET is missing or empty"; then
        pass "absent JWT_SECRET key exits 1 with a clear error"
    else
        fail "absent JWT_SECRET key exits 1 with a clear error (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: placeholder value from .env.example is rejected
# ---------------------------------------------------------------------------
test_placeholder_jwt_secret() {
    local dir exit_code
    dir="$(make_fixture)"
    printf 'JWT_SECRET=CHANGE_ME_TO_A_STRONG_RANDOM_SECRET\n' > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 1 ]] && stderr_contains "still uses the example placeholder"; then
        pass "placeholder JWT_SECRET exits 1 with a clear error"
    else
        fail "placeholder JWT_SECRET exits 1 with a clear error (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: too-short secret (< 32 chars) is rejected
# ---------------------------------------------------------------------------
test_too_short_jwt_secret() {
    local dir exit_code
    dir="$(make_fixture)"
    printf 'JWT_SECRET=short-secret-123\n' > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 1 ]] && stderr_contains "is too short"; then
        pass "too-short JWT_SECRET (<32 chars) exits 1 with a clear error"
    else
        fail "too-short JWT_SECRET (<32 chars) exits 1 with a clear error (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: exactly 32 characters is accepted (boundary)
# ---------------------------------------------------------------------------
test_exactly_32_chars_is_valid() {
    local dir exit_code secret
    dir="$(make_fixture)"
    secret="$(repeat_char a 32)" # exactly 32 'a's
    printf 'JWT_SECRET=%s\n' "$secret" > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 0 ]]; then
        pass "exactly 32-character JWT_SECRET is accepted"
    else
        fail "exactly 32-character JWT_SECRET is accepted (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: 31 characters is rejected (one below the boundary)
# ---------------------------------------------------------------------------
test_31_chars_is_rejected() {
    local dir exit_code secret
    dir="$(make_fixture)"
    secret="$(repeat_char a 31)" # exactly 31 'a's
    printf 'JWT_SECRET=%s\n' "$secret" > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 1 ]] && stderr_contains "is too short"; then
        pass "31-character JWT_SECRET is rejected as too short"
    else
        fail "31-character JWT_SECRET is rejected as too short (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: a strong, valid secret passes validation
# ---------------------------------------------------------------------------
test_valid_strong_secret() {
    local dir exit_code
    dir="$(make_fixture)"
    printf 'JWT_SECRET=Tp8vQzR2sYw9Lm4Xk1Nc6Bh3Ff7Ju0EaGd5\n' > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 0 ]]; then
        pass "strong 36-character JWT_SECRET passes validation"
    else
        fail "strong 36-character JWT_SECRET passes validation (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: double-quoted dotenv values have quotes stripped before length check
# ---------------------------------------------------------------------------
test_double_quoted_secret_is_unwrapped() {
    local dir exit_code
    dir="$(make_fixture)"
    # Quoted value is exactly 32 chars once quotes are stripped.
    printf 'JWT_SECRET="%s"\n' "$(repeat_char b 32)" > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 0 ]]; then
        pass "double-quoted 32-char JWT_SECRET is unwrapped and accepted"
    else
        fail "double-quoted 32-char JWT_SECRET is unwrapped and accepted (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: quotes count toward length before stripping, so a quoted secret that
# is only valid-length *including* the quotes should fail once unwrapped.
# ---------------------------------------------------------------------------
test_double_quoted_secret_too_short_after_unwrap() {
    local dir exit_code
    dir="$(make_fixture)"
    # 32 chars total including quotes -> only 30 chars once unwrapped.
    printf 'JWT_SECRET="%s"\n' "$(repeat_char c 30)" > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 1 ]] && stderr_contains "is too short"; then
        pass "quoted secret that is too short once unwrapped is rejected"
    else
        fail "quoted secret that is too short once unwrapped is rejected (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: single-quoted dotenv values are also unwrapped
# ---------------------------------------------------------------------------
test_single_quoted_secret_is_unwrapped() {
    local dir exit_code
    dir="$(make_fixture)"
    printf "JWT_SECRET='%s'\n" "$(repeat_char d 40)" > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 0 ]]; then
        pass "single-quoted 40-char JWT_SECRET is unwrapped and accepted"
    else
        fail "single-quoted 40-char JWT_SECRET is unwrapped and accepted (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: mismatched quotes are treated as literal characters, not stripped
# ---------------------------------------------------------------------------
test_mismatched_quotes_not_stripped() {
    local dir exit_code
    dir="$(make_fixture)"
    # Starts with a double quote, ends with a single quote: not a matching
    # pair, so no characters should be stripped. This value is 34 chars long
    # as-is, so it must remain long enough to pass (34 >= 32).
    printf 'JWT_SECRET="%s'"'"'\n' "$(repeat_char e 32)" > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 0 ]]; then
        pass "mismatched leading/trailing quotes are kept as literal characters"
    else
        fail "mismatched leading/trailing quotes are kept as literal characters (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: Windows-style CRLF line endings are handled (trailing \r stripped)
# ---------------------------------------------------------------------------
test_crlf_line_ending_is_stripped() {
    local dir exit_code
    dir="$(make_fixture)"
    printf 'JWT_SECRET=%s\r\n' "$(repeat_char f 32)" > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 0 ]]; then
        pass "trailing carriage return (CRLF) is stripped before validation"
    else
        fail "trailing carriage return (CRLF) is stripped before validation (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: leading/trailing whitespace around the "=" sign is tolerated
# ---------------------------------------------------------------------------
test_whitespace_around_equals_is_tolerated() {
    local dir exit_code
    dir="$(make_fixture)"
    printf '  JWT_SECRET   =   %s\n' "$(repeat_char g 32)" > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 0 ]]; then
        pass "whitespace around JWT_SECRET= is tolerated"
    else
        fail "whitespace around JWT_SECRET= is tolerated (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Test: when JWT_SECRET is defined multiple times, the last definition wins
# ---------------------------------------------------------------------------
test_last_duplicate_definition_wins() {
    local dir exit_code
    dir="$(make_fixture)"
    {
        echo "JWT_SECRET=short"
        printf 'JWT_SECRET=%s\n' "$(repeat_char h 32)"
    } > "$dir/.env.production"

    run_validate "$dir"
    exit_code=$?

    if [[ "$exit_code" -eq 0 ]]; then
        pass "last JWT_SECRET definition in the file takes precedence"
    else
        fail "last JWT_SECRET definition in the file takes precedence (exit=$exit_code)"
    fi

    cleanup_fixture "$dir"
}

# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------
echo "Running validate_production_env() tests..."
test_missing_env_file
test_missing_jwt_secret
test_jwt_secret_key_absent_entirely
test_placeholder_jwt_secret
test_too_short_jwt_secret
test_exactly_32_chars_is_valid
test_31_chars_is_rejected
test_valid_strong_secret
test_double_quoted_secret_is_unwrapped
test_double_quoted_secret_too_short_after_unwrap
test_single_quoted_secret_is_unwrapped
test_mismatched_quotes_not_stripped
test_crlf_line_ending_is_stripped
test_whitespace_around_equals_is_tolerated
test_last_duplicate_definition_wins

echo ""
echo "$TESTS_RUN tests run, $TESTS_FAILED failed"

if [[ "$TESTS_FAILED" -gt 0 ]]; then
    exit 1
fi
exit 0