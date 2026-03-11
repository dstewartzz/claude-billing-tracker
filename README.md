# Claude Billing Tracker

Track Claude Code session costs by client, case, or project number. Built for professionals who need to recover AI costs as billable expenses.

## What It Does

Type `/bill 119-001 Research memo` at the start of a Claude Code session. When the session ends, a hook automatically:

1. Parses the session's JSONL transcript
2. Extracts per-message token usage (input, output, cache read, cache write)
3. Identifies which model was used per API call (Opus, Sonnet, Haiku)
4. Applies Anthropic's published per-million-token rates
5. Appends a timestamped row to a CSV file

No API proxy. No npm dependencies. Just three files and Node.js built-ins.

## What Gets Tracked

Each CSV row records:

| Field | Example |
|-------|---------|
| `date` | 2026-03-11 |
| `case_number` | 119-001 |
| `description` | Research memo |
| `session_id` | a1b2c3d4 |
| `duration_minutes` | 45 |
| `input_tokens` | 15234 |
| `output_tokens` | 8567 |
| `cache_write_tokens` | 1234 |
| `cache_read_tokens` | 2345 |
| `cost_usd` | 0.42 |

## Installation

### 1. Copy the files

Clone this repo or download the files, then copy them into your Claude Code skills directory:

```bash
# Create the skill directory
mkdir -p ~/.claude/skills/billing/scripts

# Copy files
cp SKILL.md ~/.claude/skills/billing/
cp scripts/compute-cost.js ~/.claude/skills/billing/scripts/
cp scripts/pricing.json ~/.claude/skills/billing/scripts/
```

### 2. Add the SessionEnd hook

Add the following to your `~/.claude/settings.json`. If you already have a `hooks` section, merge the `SessionEnd` array:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/skills/billing/scripts/compute-cost.js\""
          }
        ]
      }
    ]
  }
}
```

### 3. Set your CSV output location (optional)

By default, the CSV is written to `~/claude-billing.csv`. To change it, set an environment variable:

```bash
# Custom CSV file path
export CLAUDE_BILLING_CSV="/path/to/your/claude-billing.csv"

# Or just a custom directory (file will be named claude-billing.csv)
export CLAUDE_BILLING_CSV_DIR="/path/to/your/directory"
```

## Usage

### Start billing a session

```
/bill 119-001 Cox research memo
```

### Check billing status

```
/bill status
```

### Stop billing manually (optional - sessions auto-capture on exit)

```
/bill stop
```

### Generate a monthly report

```
/bill report 2026-03
```

Output:
```
March 2026 Billing Summary
-------------------------------------------
Case        Sessions  Duration   Cost
119-001     6         4.2 hrs    $12.47
607-001     3         2.1 hrs    $8.93
-------------------------------------------
Total       9         6.3 hrs    $21.40
```

## How It Works

### The Skill (SKILL.md)

A Claude Code custom skill that teaches Claude the `/bill` commands. When you type `/bill 119-001`, Claude writes a tag file (`~/.claude/billing-active.json`) that marks the session as billable.

### The Hook (compute-cost.js)

A Node.js script that runs automatically when any Claude Code session ends. It:

- Checks for an active billing tag - if none exists, exits silently (unbilled session)
- Reads the session transcript (JSONL format) that Claude Code natively produces
- Extracts the `usage` object from each assistant message
- Looks up the model used per message and applies the correct rates from `pricing.json`
- Handles mixed-model sessions (e.g., Sonnet for main conversation, Haiku for subagent searches)
- Parses subagent transcripts from nested directories
- Computes total cost and appends a CSV row
- Deletes the billing tag file (one-time use per session)

### The Pricing File (pricing.json)

Per-million-token rates for each Claude model, including separate rates for:
- Input tokens
- Output tokens
- Cache write tokens (5-minute and 1-hour tiers)
- Cache read tokens

Update this file when Anthropic changes pricing.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (CLI)
- Node.js 18+
- No npm dependencies

## Who This Is For

- **Attorneys** recovering AI costs as case expenses
- **Consultants** billing AI usage to client engagements
- **Accountants** tracking AI costs by client matter
- **Any professional** who needs to attribute AI costs to specific projects

## License

MIT License - see [LICENSE](LICENSE) for details.
