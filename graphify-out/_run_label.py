import json
from graphify.build import build_from_json
from graphify.cluster import score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from pathlib import Path

if __name__ == "__main__":
    extraction = json.loads(Path("C:/Users/roton/murlan/graphify-out/.graphify_extract.json").read_text(encoding="utf-8"))
    detection  = json.loads(Path("C:/Users/roton/murlan/graphify-out/.graphify_detect.json").read_text(encoding="utf-8"))
    analysis   = json.loads(Path("C:/Users/roton/murlan/graphify-out/.graphify_analysis.json").read_text(encoding="utf-8"))

    G = build_from_json(extraction)
    communities = {int(k): v for k, v in analysis["communities"].items()}
    cohesion = {int(k): v for k, v in analysis["cohesion"].items()}
    tokens = {"input": extraction.get("input_tokens", 0), "output": extraction.get("output_tokens", 0)}

    labels = {
        0: "Offline Game Screen",
        1: "Package Dependencies",
        2: "Expo App Config",
        3: "Dev Dependencies",
        4: "Menu UI Components",
        5: "Game Engine (Core)",
        6: "Card View Component",
        7: "Game State Mutations",
        8: "Build Scripts",
        9: "Installed Skills Lock",
        10: "Offline Lobby Screen",
        11: "Sound Generation Scripts",
        12: "Server Storage Layer",
        13: "App Layout and Notifications",
        14: "Next.js Best Practices",
        15: "Server Socket Events",
        16: "Online Game Context",
        17: "Vercel Composition Patterns",
        18: "Server Routes and Auth",
        19: "Database Schema",
        20: "Auth Context",
        21: "Socket Context",
        22: "Theme and Design Tokens",
        23: "Vercel React Best Practices",
        24: "Online Game Screen",
        25: "Friends Screen",
        26: "Online Lobby Screen",
        27: "Room Screen",
        28: "Result Screen",
        29: "Rules Screen",
        30: "Game Shared Layout",
        31: "React Performance Rules",
        32: "Server Middleware",
        33: "Shared DB Schema Types",
        34: "Query Client",
        35: "Drizzle Config",
        36: "Settings Context",
        37: "Error Boundary",
        38: "Exchange Phase UI",
        39: "Offline Banner",
        40: "Attached UI Screenshots",
        41: "Bug Reports and Fixes",
        42: "Functional Requirements",
        43: "Production Hardening Specs",
        44: "UI Polish Specs",
        45: "Frontend Design Skill",
        46: "Find Skills Skill",
        47: "Game Engine AI",
        48: "Haptics Library",
        49: "Sounds Library",
        50: "Socket Library",
        51: "Shared Game Flow",
        52: "Server Logger",
        53: "Server Validator",
        54: "Server Session",
        55: "Server DB Connection",
        56: "Server Schemas",
        57: "Landing Page HTML",
        58: "Card Images",
        59: "Game Table Screenshots",
        60: "JS Performance Rules",
        61: "Bundle Optimization Rules",
        62: "Server Performance Rules",
        63: "Rendering Performance Rules",
        64: "Rerender Optimization Rules",
        65: "Colors Constants",
        66: "Quick Match Screen",
        67: "Invite Context",
        68: "Native Intent Handler",
        69: "Not Found Screen",
    }
    # Fill in any missing community IDs with generic labels
    for cid in communities:
        if cid not in labels:
            labels[cid] = f"Community {cid}"

    questions = suggest_questions(G, communities, labels)

    report = generate(G, communities, cohesion, labels, analysis["gods"], analysis["surprises"], detection, tokens, ".", suggested_questions=questions)
    Path("C:/Users/roton/murlan/graphify-out/GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    Path("C:/Users/roton/murlan/graphify-out/.graphify_labels.json").write_text(json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False), encoding="utf-8")
    print("Report updated with community labels")
