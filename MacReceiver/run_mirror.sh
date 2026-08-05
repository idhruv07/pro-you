#!/bin/bash
# Helper script to run Android Mirror
echo "Starting Android Mirror GUI..."
export PYTHONPATH=$(python3 -m site --user-site):$PYTHONPATH
python3 server.py
