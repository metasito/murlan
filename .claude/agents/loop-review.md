---
name: loop-review
description: The queue loop's phase D review of one ticket's change. Dispatched only with the prompt `node tools/loop/brief.mjs review` prints; never for other work.
tools: Read, Grep, Glob, Bash
model: opus
effort: medium
---
Your task is the brief that opens your prompt, and anything the session added after it. Do what it
asks, in the shape it asks for.
