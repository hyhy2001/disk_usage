import json
import random
import os
from datetime import datetime, timedelta

DISK_CONFIGS = [
    # ── Existing disks ──────────────────────────────────────────────────────
    {
        "name": "Primary Storage",
        "path": "/var/data/shared",
        "dir":  "mock_reports/disk_sda",
        "total_gb": 1000,
        "base_fill": 0.40,
        "trend": 0.40,
        "noise": 50,
    },
    {
        "name": "Archive Pool",
        "path": "/mnt/archive",
        "dir":  "mock_reports/disk_sdb",
        "total_gb": 4000,
        "base_fill": 0.60,
        "trend": 0.25,
        "noise": 100,
    },
    {
        "name": "Backup Volume",
        "path": "/mnt/backup",
        "dir":  "mock_reports/disk_sdc",
        "total_gb": 500,
        "base_fill": 0.20,
        "trend": 0.60,
        "noise": 20,
    },
    # ── New disks ────────────────────────────────────────────────────────────
    {
        "name": "NVMe SSD Boot",
        "path": "/dev/nvme0n1",
        "dir":  "mock_reports/disk_nvme0",
        "total_gb": 500,
        "base_fill": 0.70,
        "trend": 0.05,      # nearly full, barely growing
        "noise": 8,
    },
    {
        "name": "NVMe SSD Data",
        "path": "/dev/nvme1n1",
        "dir":  "mock_reports/disk_nvme1",
        "total_gb": 2000,
        "base_fill": 0.10,
        "trend": 0.65,      # new drive, filling up fast
        "noise": 60,
    },
    {
        "name": "Media Library",
        "path": "/mnt/media",
        "dir":  "mock_reports/disk_sdd",
        "total_gb": 8000,
        "base_fill": 0.80,
        "trend": 0.12,      # massive, mostly full
        "noise": 200,
    },
    {
        "name": "Temp Scratch",
        "path": "/tmp/scratch",
        "dir":  "mock_reports/disk_sde",
        "total_gb": 200,
        "base_fill": 0.05,
        "trend": 0.08,      # small, lightly used
        "noise": 15,
    },
    {
        "name": "ML Dataset",
        "path": "/mnt/ml-data",
        "dir":  "mock_reports/disk_sdf",
        "total_gb": 10000,
        "base_fill": 0.35,
        "trend": 0.55,      # biggest disk, rapid AI/ML growth
        "noise": 500,
    },
    {
        "name": "Log Archive",
        "path": "/var/log/archive",
        "dir":  "mock_reports/disk_sdg",
        "total_gb": 300,
        "base_fill": 0.55,
        "trend": 0.20,      # steady log accumulation
        "noise": 5,
    },
    {
        "name": "Dev Workspace",
        "path": "/home/dev",
        "dir":  "mock_reports/disk_sdh",
        "total_gb": 1000,
        "base_fill": 0.45,
        "trend": 0.30,      # many devs, noisy usage pattern
        "noise": 120,
    },
]

def generate_mock_data(num_files=500):
    # team_id maps match what a real config would produce
    teams = [
        {"name": "VN",    "team_id": 1},
        {"name": "US",    "team_id": 2},
        {"name": "UK",    "team_id": 3},
        {"name": "JP",    "team_id": 4},
        {"name": "EU",    "team_id": 5},
        {"name": "Other", "team_id": 6},
    ]
    team_names = [t["name"] for t in teams]
    team_id_map = {t["name"]: t["team_id"] for t in teams}

    # Assign each user to a team (deterministic, round-robin)
    user_names  = [f"user{i}" for i in range(1, 21)]
    user_team   = {u: teams[i % (len(teams) - 1)]["name"] for i, u in enumerate(user_names)}
    user_team_id = {u: team_id_map[t] for u, t in user_team.items()}

    other_users = ["www-data", "nginx", "mysql", "redis", "backup", "nobody", "daemon", "syslog", "postfix", "git"]
    base_date = datetime(2025, 1, 1)

    for disk in DISK_CONFIGS:
        output_dir = disk["dir"]
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        total_space = disk["total_gb"] * 1024 * 1024 * 1024
        noise_bytes = disk["noise"] * 1024 * 1024 * 1024

        for i in range(num_files):
            current_date = base_date + timedelta(days=i)
            date_str     = current_date.strftime("%Y%m%d")
            timestamp    = int(current_date.timestamp())

            used_space = (
                int(total_space * disk["base_fill"])
                + int(total_space * disk["trend"] * (i / num_files))
                + random.randint(-noise_bytes, noise_bytes)
            )
            used_space     = max(0, min(used_space, total_space))
            available_space = total_space - used_space

            team_usage = []
            remaining = used_space
            LOCKED_GAP = 50 * 1024 * 1024 * 1024
            for team in teams[:-1]:
                usage = random.randint(int(remaining * 0.05), int(remaining * 0.3))
                team_usage.append({"name": team["name"], "used": usage, "team_id": team["team_id"]})
                remaining -= usage
            last = teams[-1]
            team_usage.append({"name": last["name"], "used": max(0, remaining - LOCKED_GAP), "team_id": last["team_id"]})

            user_usage = []
            user_remaining = used_space
            for user in random.sample(user_names, 15):
                usage = random.randint(int(user_remaining * 0.02), int(user_remaining * 0.15))
                user_usage.append({"name": user, "used": usage, "team_id": user_team_id[user]})
                user_remaining -= usage
                if user_remaining < 0:
                    break

            MAX_OTHER_GB = 50 * 1024 * 1024 * 1024  # 50 GB cap per other user
            other_usage = []
            other_remaining = used_space // 10  # other users share ~10% of total
            sampled = random.sample(other_users, random.randint(3, 7))
            for idx, u in enumerate(sampled):
                if idx == 0:
                    # Guarantee at least one user hits close to 50 GB
                    usage = random.randint(int(MAX_OTHER_GB * 0.7), MAX_OTHER_GB)
                else:
                    usage = random.randint(int(other_remaining * 0.05), int(other_remaining * 0.4))
                    usage = min(usage, MAX_OTHER_GB)
                other_usage.append({"name": u, "used": usage})
                other_remaining -= usage
                if other_remaining <= 0:
                    break

            report = {
                "date": timestamp,
                "directory": disk["path"],
                "general_system": {
                    "total": total_space,
                    "used":  used_space,
                    "available": available_space
                },
                "team_usage": team_usage,
                "user_usage": user_usage,
                "other_usage": other_usage
            }

            filename = f"report_{date_str}.json"
            with open(os.path.join(output_dir, filename), 'w') as f:
                json.dump(report, f, indent=4)

        print(f"✅ {num_files} files → {output_dir}/ ({disk['name']} @ {disk['path']})")


PERM_PATHS = [
    "/data/projects/internal", "/var/secrets/keys", "/home/admin/.ssh",
    "/data/finance/reports", "/opt/services/config", "/var/log/audit",
    "/data/hr/salaries", "/mnt/archive/2024", "/srv/backups/encrypted",
    "/data/engineering/builds",
]
PERM_ERRORS = [
    "Permission denied",
    "Operation not permitted",
    "Access denied: insufficient privileges",
    "Cannot open directory: read permission missing",
    "Inaccessible: owner-only (700)",
]
PERM_TYPES = ["directory", "file"]

def generate_permission_issues():
    """Generate one permission_issues_<date>.json per disk (latest date)."""
    users = [f"user{i}" for i in range(1, 21)]

    for disk in DISK_CONFIGS:
        output_dir = disk["dir"]
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        # Pick 3-7 affected users
        affected = random.sample(users, random.randint(3, 7))
        user_issues = []
        for uname in affected:
            # 2-12 inaccessible items per user
            count = random.randint(2, 12)
            items = []
            for _ in range(count):
                items.append({
                    "path": random.choice(PERM_PATHS) + f"/{random.randint(1,999)}",
                    "type": random.choice(PERM_TYPES),
                    "error": random.choice(PERM_ERRORS),
                })
            user_issues.append({"name": uname, "inaccessible_items": items})

        # A few unknown/orphan items
        unknown = [
            {
                "path": random.choice(PERM_PATHS) + "/orphan",
                "type": "directory",
                "error": "Cannot stat: no such file or directory (orphaned inode)",
            }
            for _ in range(random.randint(1, 4))
        ]

        # Use the last date: base_date + 499 days
        last_date = (datetime(2025, 1, 1) + timedelta(days=499)).strftime("%Y%m%d")
        payload = {
            "date": last_date,
            "directory": disk["path"],
            "permission_issues": {
                "users": user_issues,
                "unknown_items": unknown,
            }
        }

        fname = f"permission_issues_{last_date}.json"
        with open(os.path.join(output_dir, fname), "w") as f:
            json.dump(payload, f, indent=4)

        n_items = sum(len(u["inaccessible_items"]) for u in user_issues)
        print(f"🔒 permission_issues → {output_dir}/{fname}  ({len(affected)} users, {n_items} items)")


if __name__ == "__main__":
    generate_mock_data()
    generate_permission_issues()
