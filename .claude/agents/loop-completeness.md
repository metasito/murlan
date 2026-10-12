---
name: loop-completeness
description: The queue loop's completeness check of one ticket's change against its Definition of done. Dispatched only with the prompt `node tools/loop/brief.mjs completeness` prints; never for other work.
tools: Read, Grep, Glob, Bash
model: sonnet
effort: medium
---
Your task is the brief that opens your prompt, and anything the session added after it. Do what it
asks, in the shape it asks for.
