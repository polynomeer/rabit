#!/bin/sh
# usage: run_oemer.sh image ; writes out/oemer/<stem>/ and a timing line
img=$1; stem=$(basename "${img%.*}"); d=out/oemer/$stem; mkdir -p $d
start=$(date +%s)
.venv/bin/oemer "$img" -o $d --save-cache > $d/log.txt 2>&1; rc=$?
echo "$stem rc=$rc secs=$(( $(date +%s) - start ))" >> out/oemer/timing.txt
