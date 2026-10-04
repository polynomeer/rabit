#!/bin/sh
# Generates a small fictional demo catalog with self-made tones (CAT-008):
# no third-party recordings, fictional artists. Output: infra/demo/out/manifest.json
set -eu
cd "$(dirname "$0")"
mkdir -p out
tone() { ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=$1:duration=$2" -ac 2 -c:a pcm_s16le "out/$3.wav"; }
tone 220 20 harbour
tone 330 18 tide
tone 440 22 lantern
tone 550 16 orbit
tone 660 24 ember
cat > out/manifest.json <<'JSON'
{
  "source": "demo-fixtures-v1",
  "artists": [
    { "key": "quasar", "name": "Velvet Quasar" },
    { "key": "lumen", "name": "Lumen Avenue" }
  ],
  "people": [
    { "key": "okon", "name": "Marguerite Okonkwo" },
    { "key": "bae", "name": "Bae Seo-yun" },
    { "key": "ruiz", "name": "Tomás Ruiz" }
  ],
  "labels": [{ "key": "tidal", "name": "Tidal Room Records" }],
  "recordings": [
    { "key": "harbour", "title": "Midnight Harbour", "artists": ["quasar"], "audio": "harbour.wav" },
    { "key": "tide", "title": "Morning Tide", "artists": ["quasar"], "audio": "tide.wav" },
    { "key": "lantern", "title": "Paper Lantern", "artists": ["lumen"], "audio": "lantern.wav" },
    { "key": "orbit", "title": "Slow Orbit", "artists": ["lumen"], "audio": "orbit.wav" },
    { "key": "ember", "title": "Ember (Harbour Flip)", "artists": ["lumen"], "audio": "ember.wav" }
  ],
  "releases": [
    { "key": "lights", "title": "Harbour Lights", "type": "album", "label": "tidal", "date": "2024-03-01", "artists": ["quasar"], "tracks": ["harbour", "tide"] },
    { "key": "paper", "title": "Paper Sky", "type": "ep", "label": "tidal", "date": "2025-09-12", "artists": ["lumen"], "tracks": ["lantern", "orbit", "ember"] }
  ],
  "credits": [
    { "subject": "harbour", "contributor": "okon", "role": "producer", "creation_method": "human", "basis": "verified_fact", "verification_state": "distributor_verified" },
    { "subject": "lantern", "contributor": "okon", "role": "producer", "creation_method": "human", "basis": "declared", "verification_state": "self_declared" },
    { "subject": "harbour", "contributor": "bae", "role": "performer", "instrument": "bass", "creation_method": "human" },
    { "subject": "orbit", "contributor": "bae", "role": "performer", "instrument": "bass", "creation_method": "human" },
    { "subject": "tide", "contributor": "ruiz", "role": "mixing_engineer", "creation_method": "human" }
  ],
  "relations": [
    { "from": "ember", "to": "harbour", "type": "samples", "basis": "verified_fact", "verification_state": "rights_reviewed", "license_status": "licensed" },
    { "from": "orbit", "to": "tide", "type": "influenced_by", "basis": "ml_inferred", "confidence": 0.58, "verification_state": "self_declared" }
  ],
  "claims": [
    { "subject": "harbour", "stage": "composition", "method": "human", "issuer": "Tidal Room Records", "verification_state": "distributor_verified" },
    { "subject": "ember", "stage": "mastering", "method": "ai_assisted", "issuer": "Lumen Avenue" }
  ],
  "grants": [
    { "recording": "harbour", "rights_holder": "Tidal Room Records", "territories": ["KR"], "uses": ["stream"], "contract_ref": "DEMO-1" },
    { "recording": "tide", "rights_holder": "Tidal Room Records", "territories": ["KR"], "uses": ["stream"], "contract_ref": "DEMO-1" },
    { "recording": "lantern", "rights_holder": "Tidal Room Records", "territories": ["KR"], "uses": ["stream"], "contract_ref": "DEMO-1" },
    { "recording": "orbit", "rights_holder": "Tidal Room Records", "territories": ["WORLD"], "uses": ["stream"], "contract_ref": "DEMO-1" },
    { "recording": "ember", "rights_holder": "Tidal Room Records", "territories": ["KR"], "uses": ["stream"], "contract_ref": "DEMO-1" }
  ]
}
JSON
echo "infra/demo/out/manifest.json"
