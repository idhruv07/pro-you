# [DEPRECATED] Goal
> **Note**: This plan has been superseded. We have switched to using `scrcpy` over Wi-Fi for a more robust and performant mirroring solution. The custom Android implementation described below is no longer being actively developed.

Provide a robust solution that sends H.264 NAL units with Annex‑B start codes from the Android sender, allowing the macOS receiver to decode the stream without using the `h264_mp4toannexb` bit‑stream filter.

## Proposed Changes
### Android Sender (`ScreenCaptureService.kt`)
- **Add SPS/PPS transmission**: Retrieve codec specific data (`csd-0`, `csd-1`) from `MediaFormat` after codec configuration and send them once at the start, each prefixed with the 4‑byte start code `0x00 0x00 0x00 0x01`.
- **Prepend start code to every video buffer** before writing to the socket:
  ```kotlin
  val startCode = byteArrayOf(0x00, 0x00, 0x00, 0x01)
  val outData = ByteArray(bufferInfo.size)
  buffer.get(outData)
  outputStream?.write(startCode)
  outputStream?.write(outData)
  outputStream?.flush()
  ```
- **Remove the unused `startCode` variable that was previously defined but not used**.
- **Log each transmitted NAL unit** (optional) for debugging.
- **Ensure error handling** remains unchanged.

### macOS Receiver (`mirror_fast.py`)
- **Simplify FFmpeg command** – drop the bit‑stream filter:
  ```python
  ffmpeg_cmd = [
      'ffmpeg',
      '-fflags', '+genpts+discardcorrupt',
      '-flags', '+low_delay',
      '-strict', 'experimental',
      '-f', 'h264',            # input is raw Annex‑B H.264
      '-i', 'pipe:0',
      '-pix_fmt', 'bgr0',
      '-f', 'rawvideo',
      '-an', '-sn',
      'pipe:1'
  ]
  ```
- No other code changes are required because the rest of the pipeline (reading stdout, converting to NumPy frames, displaying with OpenCV) already expects raw video frames.
- Optionally **add a comment** noting that the stream now follows Annex‑B format.

## Verification Plan
1. **Unit‑level verification** on Android:
   - Run the app on the emulator/device and capture the first few bytes sent over the socket (e.g., using `tcpdump` or a temporary Python socket server). Verify that the stream begins with `00 00 00 01` followed by SPS/PPS NAL units.
2. **End‑to‑end test** on macOS:
   - Start `run_mirror.sh` and launch the Android app.
   - Observe that the FFmpeg process no longer prints `missing picture in access unit` or `No start code is found` errors.
   - Confirm that a video window appears and displays the mirrored screen.
3. **Stress test**:
   - Keep the connection alive for several minutes, rotate the device screen, and verify continuous frame updates without crashes.

## Roll‑back Strategy
If the start‑code injection causes incompatibility on a real device, revert to the previous AVCC‑only approach by commenting out the `outputStream?.write(startCode)` line and re‑adding the `-bsf:v h264_mp4toannexb` flag in the Python script.
