# Từ Trái Nghĩa — Music Guide

The game looks for audio files in `public/vietgames/assets/tutrainghia/music/`. All audio slots are optional; missing files are skipped silently without errors.

## Naming Conventions

1. **Level Music (by Color)**:
   One loop per level color, used across all sets:
   - `1-red.mp3` (Level 1: Đỏ)
   - `2-orange.mp3` (Level 2: Cam)
   - `3-yellow.mp3` (Level 3: Vàng)
   - `4-green.mp3` (Level 4: Xanh lá)
   - `5-blue.mp3` (Level 5: Xanh dương)
   - `6-indigo.mp3` (Level 6: Chàm)
   - `7-violet.mp3` (Level 7: Tím)
   - `8-rainbow.mp3` (Level 8: Cầu vồng)

   *Note*: If you added `red.mp3`, rename it to **`1-red.mp3`** (or `s1-1-red.mp3` for set 1 specific) so the game recognizes it for level 1.

2. **Per-Set Overrides**:
   You can override music for a specific set and level using:
   - `s<set>-<level>-<colour>.mp3` (e.g., `s2-3-yellow.mp3` for set 2, level 3).
     - Sets are 1 to 4 (`s1` = Thành Phố, `s2` = Đồng Quê, `s3` = Bờ Biển, `s4` = Vùng Núi).

3. **Underwater Music**:
   - `water.mp3` (default underwater loop when falling into water/chasms).
   - `s<set>-water.mp3` (set-specific underwater loop, e.g., `s2-water.mp3`).
