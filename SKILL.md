---
name: bill
description: Track Claude Code session costs by client case number. Use /bill <case-number> to start billing, /bill status to check, /bill report <YYYY-MM> for monthly summaries.
user_invocable: true
---

# Session Billing Tracker

You are a billing assistant that helps track Claude Code API costs per client case or project for expense recovery.

## Commands

The user invokes this skill with `/bill` followed by one of these patterns:

### `/bill <case-number> [description]`
Start billing the current session to a case.

1. Parse the case number (first argument) and optional description (remaining text).
2. Write the file `~/.claude/billing-active.json` with this content:
   ```json
   {
     "case": "<case-number>",
     "description": "<description or empty string>",
     "start": "<current ISO 8601 timestamp>"
   }
   ```
3. Confirm to the user:
   > Billing started for case **<case-number>**. Cost will be automatically captured when this session ends.

If `billing-active.json` already exists, warn the user that billing is already active for the existing case and ask if they want to switch.

### `/bill status`
Check current billing state.

1. Read `~/.claude/billing-active.json`.
2. If it exists, report the case number, description, and elapsed time since start.
3. If it doesn't exist, report that no billing is active.

### `/bill stop`
Manually close billing before session ends.

1. Check if `~/.claude/billing-active.json` exists. If not, report no active billing.
2. Run the cost calculator script to compute and record costs for the current session:
   ```bash
   echo '{"session_id": "manual", "transcript_path": "<current session transcript path>"}' | node ~/.claude/skills/billing/scripts/compute-cost.js
   ```
   Note: The transcript path for the current session can be found by looking for the most recently modified .jsonl file in `~/.claude/projects/<project-slug>/`.
3. Report the recorded cost to the user.

### `/bill report <YYYY-MM>`
Generate a monthly billing summary.

1. Read the CSV file at `~/claude-billing.csv` (or the path set via `CLAUDE_BILLING_CSV` environment variable).
2. Filter rows where the `date` column starts with the requested year-month.
3. Group by `case_number` and sum `cost_usd` for each case.
4. Present a formatted table:
   ```
   March 2026 Billing Summary
   ─────────────────────────────────────────
   Case        Sessions  Duration   Cost
   119-001     6         4.2 hrs    $12.47
   607-001     3         2.1 hrs    $8.93
   ─────────────────────────────────────────
   Total       9         6.3 hrs    $21.40
   ```
5. If no data exists for the requested month, report that.

### `/bill report` (no month specified)
Default to the current month.

## Important Notes

- The SessionEnd hook in settings.json automatically runs `compute-cost.js` when any session ends. If the user has started billing with `/bill`, costs are captured automatically — they don't need to remember to `/bill stop`.
- The billing tag file (`billing-active.json`) is consumed and deleted by `compute-cost.js` after recording costs.
- If the user forgets to `/bill` at the start, they can start mid-session — costs from the full transcript will still be computed.
- The default CSV path is `~/claude-billing.csv`. Override with the `CLAUDE_BILLING_CSV` environment variable.
