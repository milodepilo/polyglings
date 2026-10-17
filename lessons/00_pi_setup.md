# 00 – Setting up the Pi

Goal: a headless Pi 4B that you can reach from WSL over SSH, with Node 22, g++ and Claude Code on it.

## 1. Flashing
1. Install **Raspberry Pi Imager** on Windows.
2. Device: *Raspberry Pi 4* → OS: *Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)*.
3. Storage: a USB SSD if you have one (more durable than an SD card), otherwise an SD card.
4. **Edit settings** (important, it saves you a monitor and keyboard):
   - hostname: `polyglings`
   - username + password (e.g. `milo`)
   - Wi-Fi (or use ethernet, which is more stable for a server)
   - Services → **Enable SSH** → *Allow public-key authentication only* → paste the contents of `~/.ssh/id_ed25519.pub` from WSL
     (no key yet? On WSL: `ssh-keygen -t ed25519`)
5. Flash, plug it in, power it on, wait about 2 minutes.

## 2. Connecting
```bash
ssh milo@polyglings.local      # mDNS; if that fails, look up the IP in your router
```
Handy: add this to `~/.ssh/config` on WSL:
```
Host pi
    HostName polyglings.local
    User milo
```
After that, `ssh pi` is enough.

## 3. Packages
```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git build-essential      # g++, make
# Node 22 via NodeSource (apt's Node is too old)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version && g++ --version
```
> Question for you: why don't we use `nvm` here, like you might on a laptop?
> (Hint: who will run Node later? Your user, or a systemd service?)

## 4. Claude Code + your Pro subscription
```bash
curl -fsSL https://claude.ai/install.sh | bash
claude setup-token        # log in with your Pro account, gives you a long-lived token
```
Store the token **not** in git but in a file only you can read:
```bash
sudo mkdir -p /etc/polyglings
echo 'CLAUDE_CODE_OAUTH_TOKEN=<token>' | sudo tee /etc/polyglings/env
sudo chmod 600 /etc/polyglings/env
```
Test it:
```bash
claude -p "Say hi in one word" --output-format json
```
You should see JSON with a `result` field. You'll parse exactly that output in milestone 5.

## Done when
- [ ] `ssh pi` works without a password
- [ ] `node --version` shows v22.x, `g++ --version` works
- [ ] `claude -p ... --output-format json` returns JSON
