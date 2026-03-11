#!/usr/bin/env node

/**
 * Claude Code Session Billing - Cost Calculator
 *
 * Reads a Claude Code session transcript JSONL, computes the actual API cost
 * from token usage data, and appends a row to a CSV billing log.
 *
 * Designed to run as a SessionEnd hook. Receives JSON on stdin with:
 *   { session_id, transcript_path, ... }
 *
 * Requires a billing tag file (~/.claude/billing-active.json) to be present,
 * otherwise exits silently (unbilled session).
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const os = require("os");

// --- Configuration ---

const BILLING_TAG_PATH = path.join(os.homedir(), ".claude", "billing-active.json");
const PRICING_PATH = path.join(__dirname, "pricing.json");

// Default CSV location — can be overridden via CLAUDE_BILLING_CSV env var
const DEFAULT_CSV_DIR = process.env.CLAUDE_BILLING_CSV_DIR || path.join(
  os.homedir(),
  "OneDrive - Stewart Robbins Brown & Altazan, LLC",
  "Claude's Folder"
);
const CSV_PATH = process.env.CLAUDE_BILLING_CSV || path.join(DEFAULT_CSV_DIR, "claude-billing.csv");

const CSV_HEADER = "date,case_number,description,session_id,duration_minutes,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cost_usd";

// --- Main ---

async function main() {
  // 1. Read stdin for hook payload
  const hookInput = await readStdin();
  let sessionId, transcriptPath;

  try {
    const payload = JSON.parse(hookInput);
    sessionId = payload.session_id;
    transcriptPath = payload.transcript_path;
  } catch {
    // If no valid JSON on stdin, try CLI args (for manual testing)
    transcriptPath = process.argv[2];
    sessionId = process.argv[3] || path.basename(transcriptPath || "", ".jsonl");
  }

  if (!transcriptPath) {
    process.exit(0); // No transcript path — nothing to do
  }

  // 2. Check for billing tag
  if (!fs.existsSync(BILLING_TAG_PATH)) {
    process.exit(0); // No active billing — silent exit
  }

  let billingTag;
  try {
    billingTag = JSON.parse(fs.readFileSync(BILLING_TAG_PATH, "utf-8"));
  } catch {
    console.error("[billing] Could not parse billing-active.json");
    process.exit(1);
  }

  // 3. Load pricing
  let pricing;
  try {
    pricing = JSON.parse(fs.readFileSync(PRICING_PATH, "utf-8")).models;
  } catch (err) {
    console.error("[billing] Could not load pricing.json:", err.message);
    process.exit(1);
  }

  // 4. Parse transcript JSONL(s) for token usage
  const transcriptFiles = [transcriptPath];

  // Also check for subagent transcripts
  const sessionDir = transcriptPath.replace(/\.jsonl$/, "");
  const subagentsDir = path.join(sessionDir, "subagents");
  if (fs.existsSync(subagentsDir)) {
    try {
      const subFiles = fs.readdirSync(subagentsDir)
        .filter(f => f.endsWith(".jsonl"))
        .map(f => path.join(subagentsDir, f));
      transcriptFiles.push(...subFiles);
    } catch {
      // Ignore errors reading subagents directory
    }
  }

  let totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
  };
  let totalCost = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;

  for (const filePath of transcriptFiles) {
    if (!fs.existsSync(filePath)) continue;
    const result = await parseTranscript(filePath, pricing);
    totals.input_tokens += result.input_tokens;
    totals.output_tokens += result.output_tokens;
    totals.cache_write_tokens += result.cache_write_tokens;
    totals.cache_read_tokens += result.cache_read_tokens;
    totalCost += result.cost;

    if (result.firstTimestamp) {
      if (!firstTimestamp || result.firstTimestamp < firstTimestamp) {
        firstTimestamp = result.firstTimestamp;
      }
    }
    if (result.lastTimestamp) {
      if (!lastTimestamp || result.lastTimestamp > lastTimestamp) {
        lastTimestamp = result.lastTimestamp;
      }
    }
  }

  // 5. Compute duration
  let durationMinutes = 0;
  if (firstTimestamp && lastTimestamp) {
    durationMinutes = Math.round((lastTimestamp - firstTimestamp) / 60000);
  } else if (billingTag.start) {
    durationMinutes = Math.round((Date.now() - new Date(billingTag.start).getTime()) / 60000);
  }

  // 6. Write CSV row
  const date = new Date().toISOString().slice(0, 10);
  const shortSessionId = (sessionId || "unknown").slice(0, 8);
  const description = (billingTag.description || "").replace(/,/g, ";").replace(/"/g, "'");
  const caseNumber = billingTag.case || "UNKNOWN";
  const costRounded = totalCost.toFixed(2);

  const row = [
    date,
    caseNumber,
    `"${description}"`,
    shortSessionId,
    durationMinutes,
    totals.input_tokens,
    totals.output_tokens,
    totals.cache_write_tokens,
    totals.cache_read_tokens,
    costRounded,
  ].join(",");

  // Ensure CSV directory exists
  const csvDir = path.dirname(CSV_PATH);
  if (!fs.existsSync(csvDir)) {
    fs.mkdirSync(csvDir, { recursive: true });
  }

  // Write header if file doesn't exist
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, CSV_HEADER + "\n", "utf-8");
  }

  fs.appendFileSync(CSV_PATH, row + "\n", "utf-8");

  // 7. Clean up billing tag
  try {
    fs.unlinkSync(BILLING_TAG_PATH);
  } catch {
    // Ignore — may already be cleaned up
  }

  console.log(`[billing] Recorded $${costRounded} for case ${caseNumber} (${durationMinutes}min)`);
}

// --- Helpers ---

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));

    // If stdin is a TTY (manual run), resolve immediately
    if (process.stdin.isTTY) {
      resolve("");
    }

    // Timeout after 2 seconds in case stdin never closes
    setTimeout(() => resolve(data), 2000);
  });
}

async function parseTranscript(filePath, pricing) {
  const result = {
    input_tokens: 0,
    output_tokens: 0,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    cost: 0,
    firstTimestamp: null,
    lastTimestamp: null,
  };

  const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Extract timestamp if present
    if (obj.timestamp) {
      const ts = new Date(obj.timestamp).getTime();
      if (!isNaN(ts)) {
        if (!result.firstTimestamp || ts < result.firstTimestamp) result.firstTimestamp = ts;
        if (!result.lastTimestamp || ts > result.lastTimestamp) result.lastTimestamp = ts;
      }
    }

    // Extract usage from assistant messages
    const usage = obj.message?.usage;
    if (!usage) continue;

    const model = obj.message?.model || "claude-sonnet-4-6";
    const rates = findRates(model, pricing);
    if (!rates) continue;

    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheReadTokens = usage.cache_read_input_tokens || 0;

    // Cache write tokens — use detailed breakdown if available
    let cacheWrite5m = 0;
    let cacheWrite1h = 0;
    if (usage.cache_creation) {
      cacheWrite5m = usage.cache_creation.ephemeral_5m_input_tokens || 0;
      cacheWrite1h = usage.cache_creation.ephemeral_1h_input_tokens || 0;
    } else {
      // Fall back to aggregate field (treat as 5m tier)
      cacheWrite5m = usage.cache_creation_input_tokens || 0;
    }

    const totalCacheWrite = cacheWrite5m + cacheWrite1h;

    // Accumulate token counts
    result.input_tokens += inputTokens;
    result.output_tokens += outputTokens;
    result.cache_write_tokens += totalCacheWrite;
    result.cache_read_tokens += cacheReadTokens;

    // Compute cost for this message
    const messageCost =
      (inputTokens * rates.input +
        outputTokens * rates.output +
        cacheWrite5m * rates.cache_write_5m +
        cacheWrite1h * rates.cache_write_1h +
        cacheReadTokens * rates.cache_read) /
      1_000_000;

    result.cost += messageCost;
  }

  return result;
}

function findRates(model, pricing) {
  // Exact match first
  if (pricing[model]) return pricing[model];

  // Prefix match (e.g., "claude-opus-4-6-20260301" matches "claude-opus-4-6")
  for (const key of Object.keys(pricing)) {
    if (model.startsWith(key)) return pricing[key];
  }

  // Fallback: try to match the family
  if (model.includes("opus")) {
    return pricing["claude-opus-4-6"] || pricing["claude-opus-4-5"];
  }
  if (model.includes("sonnet")) {
    return pricing["claude-sonnet-4-6"] || pricing["claude-sonnet-4"];
  }
  if (model.includes("haiku")) {
    return pricing["claude-haiku-4-5"] || pricing["claude-haiku-3-5"];
  }

  console.error(`[billing] Unknown model: ${model}, using sonnet rates`);
  return pricing["claude-sonnet-4-6"];
}

main().catch((err) => {
  console.error("[billing] Error:", err.message);
  process.exit(1);
});
