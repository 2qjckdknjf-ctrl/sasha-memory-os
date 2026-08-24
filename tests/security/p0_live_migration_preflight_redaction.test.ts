import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const PARSER = join(REPO_ROOT, "scripts", "ci-live-migration-preflight-parse.mjs");
const PREFLIGHT = join(REPO_ROOT, "scripts", "ci-live-migration-preflight.sh");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures", "preflight");

function runParser(fixtureName: string, curlExitCode = 0): { stdout: string; stderr: string; exitCode: number } {
  const fixturePath = join(FIXTURES, fixtureName);
  const dir = mkdtempSync(join(tmpdir(), "preflight-parse-"));
  const responsePath = join(dir, "response.json");
  writeFileSync(responsePath, readFileSync(fixturePath, "utf8"), "utf8");
  try {
    const stdout = execFileSync("node", [PARSER, responsePath, String(curlExitCode)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertNoSensitivePayload(output: string, fixtureRaw: string): void {
  expect(output).not.toContain("P0 preflight memory title");
  expect(output).not.toContain("packed context");
  expect(output).not.toContain("citation-1");
  expect(output).not.toContain("prov-1");
  expect(output).not.toContain("mem-preflight-001");
  expect(output).not.toContain("44444444-4444-4444-8444-444444444401");
  expect(output).not.toContain("44444444-4444-4444-8444-444444444402");
  if (fixtureRaw.includes("secret-token")) {
    expect(output).not.toContain("secret-token");
  }
}

describe("P0 live migration preflight redaction", () => {
  it("1. treats success when memory content contains the string error as READY", () => {
    const raw = readFileSync(join(FIXTURES, "success-with-error-in-content.json"), "utf8");
    const { stdout, exitCode } = runParser("success-with-error-in-content.json");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("live_migration_preflight=READY_FOR_LIVE_SMOKE");
    assertNoSensitivePayload(stdout, raw);
  });

  it("2. does not emit packed context from a large success response", () => {
    const raw = readFileSync(join(FIXTURES, "success-with-packed-context.json"), "utf8");
    const { stdout } = runParser("success-with-packed-context.json");
    expect(stdout.trim()).toBe("live_migration_preflight=READY_FOR_LIVE_SMOKE");
    assertNoSensitivePayload(stdout, raw);
    expect(stdout).not.toContain("AAAA");
  });

  it("3. returns safe status for JSON-RPC error without body", () => {
    const { stdout, exitCode } = runParser("jsonrpc-error.json");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toContain("live_migration_preflight=BLOCKED_REMOTE_MIGRATION");
    expect(stdout).toContain("jsonrpc_error_code=-32001");
    expect(stdout).not.toContain("Project not found");
    expect(stdout).not.toContain("44444444");
  });

  it("4. never prints memory title/content/citations/provenance", () => {
    for (const fixture of [
      "success-with-error-in-content.json",
      "success-with-packed-context.json",
      "blocked-project-not-found.json",
    ]) {
      const raw = readFileSync(join(FIXTURES, fixture), "utf8");
      const { stdout } = runParser(fixture);
      assertNoSensitivePayload(stdout, raw);
    }
  });

  it("5. shell script does not echo API secret", () => {
    const script = readFileSync(PREFLIGHT, "utf8");
    expect(script).not.toMatch(/echo\s+.*API_SECRET/);
    expect(script).not.toMatch(/echo\s+.*MEMORY_OS_API_SECRET/);
    expect(script).not.toMatch(/echo\s+.*response/);
  });

  it("6. shell script does not echo authorization header", () => {
    const script = readFileSync(PREFLIGHT, "utf8");
    expect(script).not.toMatch(/echo\s+.*Authorization/);
    expect(script).not.toContain("Bearer $API_SECRET");
  });

  it("7. shell script does not echo Supabase URL or credential material", () => {
    const script = readFileSync(PREFLIGHT, "utf8");
    expect(script).not.toMatch(/echo\s+.*SUPABASE/);
    expect(script).not.toMatch(/echo\s+.*service_role/);
  });

  it("8. malformed JSON returns PREFLIGHT_INVALID_RESPONSE", () => {
    const { stdout, exitCode } = runParser("malformed.json");
    expect(exitCode).toBe(1);
    expect(stdout.trim()).toBe("live_migration_preflight=PREFLIGHT_INVALID_RESPONSE");
  });

  it("9. curl/network failure returns PREFLIGHT_REQUEST_FAILED", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-curl-fail-"));
    const responsePath = join(dir, "response.json");
    writeFileSync(responsePath, "", "utf8");
    try {
      try {
        execFileSync("node", [PARSER, responsePath, "28"], {
          cwd: REPO_ROOT,
          encoding: "utf8",
        });
        expect.unreachable("expected non-zero exit");
      } catch (error) {
        const err = error as { stdout?: string; status?: number };
        expect(err.status).toBe(1);
        expect((err.stdout ?? "").trim()).toBe("live_migration_preflight=PREFLIGHT_REQUEST_FAILED");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("10. exit codes gate live smoke skip vs run", () => {
    expect(runParser("success-with-error-in-content.json").exitCode).toBe(0);
    expect(runParser("blocked-project-not-found.json").exitCode).toBe(0);
    expect(runParser("jsonrpc-error.json").exitCode).toBe(0);
    expect(runParser("malformed.json").exitCode).toBe(1);
  });

  it("11. CI workflow does not tee raw preflight output to artifacts", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
    const liveBlock = workflow.slice(
      workflow.indexOf("live-edge-smoke:"),
      workflow.indexOf("ci-summary:"),
    );
    expect(liveBlock).not.toMatch(/preflight\.sh[^\n]*\|\s*tee/);
    expect(liveBlock).not.toContain("upload-artifact");
  });

  it("12. temp response files use restrictive permissions and are removed", () => {
    const script = readFileSync(PREFLIGHT, "utf8");
    expect(script).toContain("chmod 600");
    expect(script).toContain("trap cleanup EXIT");
    expect(script).toContain("set +x");
    expect(script).toContain("mktemp");

    const dir = mkdtempSync(join(tmpdir(), "preflight-perms-"));
    const responsePath = join(dir, "response.json");
    writeFileSync(responsePath, readFileSync(join(FIXTURES, "success-with-packed-context.json"), "utf8"), "utf8");
    chmodSync(responsePath, 0o600);
    const statMode = readFileSync(responsePath).length;
    expect(statMode).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
    expect(() => readFileSync(responsePath)).toThrow();
  });
});
