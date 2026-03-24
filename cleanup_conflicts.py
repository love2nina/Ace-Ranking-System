import os

files = [
    "ui.js", "style.css", "statsService.js", "README_STATS.md", 
    "index.html", "firebase-api.js", "engine.js"
]

for filename in files:
    if not os.path.exists(filename):
        continue
    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    new_lines = []
    keep = False
    found_conflict = False
    
    # Simple state machine to keep only the HEAD part
    state = "normal" # "normal", "head", "tail"
    
    for line in lines:
        if line.startswith("<<<<<<< HEAD"):
            state = "head"
            found_conflict = True
            continue
        elif line.startswith("======="):
            state = "tail"
            continue
        elif line.startswith(">>>>>>> "):
            state = "normal"
            continue
        
        if state == "head" or state == "normal":
            new_lines.append(line)
            
    if found_conflict:
        with open(filename, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
        print(f"Fixed {filename}")
    else:
        print(f"No conflict found in {filename}")
