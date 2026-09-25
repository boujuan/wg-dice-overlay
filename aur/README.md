# AUR Package: wg-dice-overlay-bin

This directory contains the Arch User Repository (AUR) packaging files for `wg-dice-overlay-bin`.

## Testing / Installing Locally

To build and install the package locally using `makepkg` and `pacman`:

```bash
cd aur
makepkg -si
```

Alternatively, install the precompiled `.pkg.tar.zst` from `dist/`:

```bash
sudo pacman -U ../dist/wg-dice-overlay-bin-1.1.5-1-x86_64.pkg.tar.zst
```

## Publishing to AUR

If you have an AUR account and SSH key configured:

```bash
# 1. Clone the AUR repository (or initialize it if first time)
git clone ssh://aur@aur.archlinux.org/wg-dice-overlay-bin.git /tmp/wg-dice-overlay-bin

# 2. Copy the AUR files
cp aur/{PKGBUILD,.SRCINFO,wg-dice-overlay.desktop,icon.png,LICENSE} /tmp/wg-dice-overlay-bin/

# 3. Commit and push to AUR
cd /tmp/wg-dice-overlay-bin
git add PKGBUILD .SRCINFO wg-dice-overlay.desktop icon.png LICENSE
git commit -m "feat: release v1.1.5"
git push origin master
```
