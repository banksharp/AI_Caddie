# App icons and splash

Add these image files here so the app logo and splash screen work:

| File | Size | Use |
|------|------|-----|
| **icon.png** | **1024×1024** px | App icon (home screen / app drawer). No transparency on iOS. |
| **splash.png** | **1284×2778** px (or same aspect as phone) | Logo shown on splash screen. Centered on `#2D6A4F` background. |
| **adaptive-icon.png** | **1024×1024** px | Android adaptive icon (foreground). Safe zone: center 66%; can have transparency. |

**Quick option:** Use one square logo for everything:
- Export your logo as **1024×1024** PNG.
- Save as `icon.png` and copy to `adaptive-icon.png`.
- For splash, use the same image or a wider version (e.g. 1024×1024 centered on green) and save as `splash.png`.

After adding the files, rebuild the app (`npx expo prebuild --clean` then run, or `eas build`) so the new icon and splash are used.
