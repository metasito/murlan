#!/usr/bin/env bash
# KVM is present on the standard Linux runner but not exposed to the user by default; without it
# the emulator falls back to software emulation and is far too slow to finish a round.
set -euo pipefail

echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm
