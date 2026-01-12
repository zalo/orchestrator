# Creating Skills

## Overview
Skills are documented solutions and patterns stored in `.claude/skills/`. They capture institutional knowledge that helps future agents work faster and avoid repeating mistakes.

## When to Create a Skill

Create a skill when you:
- **Solve a challenging problem** that required significant troubleshooting or iteration
- **Discover a non-obvious pattern** that isn't documented elsewhere
- **Complete a repeatable process** that other agents will need to do
- **Fix a tricky bug** whose root cause or solution isn't obvious
- **Learn a project-specific convention** that affects how work should be done

## Skill File Format

```markdown
# [Skill Name]

## Overview
[One sentence describing what this skill covers]

## When to Use
[Describe the scenarios where this skill applies]

## Prerequisites
- [Any required setup, tools, or context]

## Steps
1. [First step with exact command if applicable]
2. [Second step]
3. [Continue...]

## Example
[Show a concrete example if helpful]

## Troubleshooting
- **If [problem]**: [solution]
- **If [another problem]**: [solution]

## Tags
- [tag1]
- [tag2]

## Last Updated
[Date] - [Brief note about what changed]
```

## Best Practices

1. **Be specific** - Include exact commands, file paths, and error messages
2. **Include context** - Explain WHY something works, not just WHAT to do
3. **Add troubleshooting** - Document edge cases and failures you encountered
4. **Use tags** - Help future agents find relevant skills via search
5. **Keep it focused** - One skill per file, covering one topic well
6. **Update dates** - Note when skills are verified or changed

## API Reference

```bash
# List all skills (metadata only, lightweight)
curl "http://localhost:3001/api/skills?workspaceId=YOUR_WORKSPACE_ID"

# Read a specific skill (full content)
curl "http://localhost:3001/api/skills/[skill-name]?workspaceId=YOUR_WORKSPACE_ID"

# Search skills by keyword
curl "http://localhost:3001/api/skills/search/[query]?workspaceId=YOUR_WORKSPACE_ID"
```

## Tags
- skills
- documentation
- knowledge-management

## Last Updated
2026-01-11 - Initial creation
