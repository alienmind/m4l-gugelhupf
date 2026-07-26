# Visualizer Enhancements Assessment

## Current State & Limitations
Currently, the `Visualizer.tsx` in the device view only renders a scrolling peak trail and a stereo peak meter. As noted in the codebase:
> *"WHY A LEVEL AND NOT A WAVEFORM. `[jweb~]` is "Web browser with audio output" - one control inlet, no signal inlet - so no page can be handed audio."*

The visualizer currently relies on a `level_${windowId}` message sent from a `[peakamp~]` object in the Max patcher a few dozen times a second. This scalar value (amplitude peak) is insufficient for drawing rich visualizations like an Oscilloscope (requires time-domain waveform data), a Sonogram (requires frequency-domain spectrum data), or a Spectrogram (requires frequency over time).

Furthermore, sound in `m4l-gugelhupf` can be generated in two separate Chromium contexts:
1. **The Inline Engine (`useStrudelRender.ts`)**: Runs directly inside the device's `jweb~` component.
2. **The Studio (REPL Window)**: Runs in its own separate `jweb~` window.

## Proposed Technical Solutions for Data Gathering

To draw the three new visualizations, we need arrays of time-domain and frequency-domain data at a high frame rate (e.g., 60fps). We have two main architectural approaches to get this data into `Visualizer.tsx`:

### Approach A: In-Browser Web Audio API (Recommended)
We can utilize the browser's native `AnalyserNode` attached to the Web Audio `AudioContext.destination`. 

* **For the Inline Engine**: We already have access to the `AudioContext` in `useStrudelRender.ts`. We can simply attach an `AnalyserNode` and read `getFloatTimeDomainData()` and `getByteFrequencyData()` directly inside `Visualizer.tsx`.
* **For the Studio REPL**: Since it runs in a different Chromium context, the device window cannot directly read its `AudioContext`. However, we can perform the `AnalyserNode` extraction inside the Studio window and transmit the resulting arrays (e.g., `Float32Array` of 256 samples) to the device window using a **`BroadcastChannel`**. This keeps all high-bandwidth analysis and data transfer entirely within the JavaScript engines, avoiding the Max bridge.

**Pros:** Highly performant, leverages optimized native C++ Web Audio FFT, avoids Max message queue flooding.
**Cons:** Requires handling cross-window communication (`BroadcastChannel`) for the external REPL.

### Approach B: Max/MSP Audio Analysis
Perform the analysis natively in the Max patcher on the audio signal (after it exits `jweb~`) and send the data back into the device's `jweb~`.

* **Oscilloscope**: Downsample the audio signal and send arrays of floats from Max to JS.
* **Sonogram/Spectrogram**: Use Jitter (`jit.catch~` -> `jit.fft`) or `pfft~` to compute frequency bins, format them into lists/dictionaries, and send them to the `jweb~` inlet.

**Pros:** Analyzes the actual final audio track output, regardless of which window generated it.
**Cons:** Sending large arrays (e.g., 256-512 values) at 30-60 frames per second via Max messages to `jweb~` can cause significant UI thread overhead and latency in Live.

---

## Implementation Details for the Visualizations

Assuming we proceed with **Approach A** and have arrays of `timeData` (waveform) and `freqData` (spectrum) inside `Visualizer.tsx`, here is how to implement the three views on an HTML5 `<canvas>`:

### 1. Oscilloscope (Waveform)
* **Data needed:** `Float32Array` containing time-domain audio samples (values between -1.0 and 1.0).
* **Rendering:** Clear the canvas on each frame. Map the array index to the X-axis and the sample amplitude to the Y-axis. 
* **Code pattern:** 
  ```javascript
  ctx.beginPath();
  for (let i = 0; i < timeData.length; i++) {
      const x = (i / timeData.length) * width;
      const y = (timeData[i] * 0.5 + 0.5) * height; // Scale -1..1 to canvas height
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ```

### 2. Sonogram (Spectrum Analyzer)
* **Data needed:** `Uint8Array` containing frequency bin magnitudes (values between 0 and 255).
* **Rendering:** Draw filled vertical bars or a filled continuous curve. The X-axis represents the frequency bin (often converted to a logarithmic scale for better musical representation), and the Y-axis represents the magnitude.
* **Code pattern:**
  ```javascript
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let i = 0; i < freqData.length; i++) {
      const x = (i / freqData.length) * width;
      const y = height - (freqData[i] / 255.0) * height;
      ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.fill();
  ```

### 3. Spectrogram (Frequency Waterfall)
* **Data needed:** Same `Uint8Array` frequency data, but preserving a history over time.
* **Rendering:** This requires a scrolling approach. Instead of clearing the canvas, you can shift the existing image data to the left and draw a new vertical 1-pixel-wide line on the right edge.
* **Code pattern:**
  ```javascript
  // Shift previous frames left
  const imgData = ctx.getImageData(1, 0, width - 1, height);
  ctx.putImageData(imgData, 0, 0);
  
  // Draw new column on the right edge
  for (let i = 0; i < freqData.length; i++) {
      const y = height - (i / freqData.length) * height;
      const intensity = freqData[i]; // Map 0-255 to a color scale (e.g., dark to teal)
      ctx.fillStyle = `rgb(0, ${intensity}, ${intensity})`;
      ctx.fillRect(width - 1, y, 1, 1);
  }
  ```

## Conclusion
To implement the desired visualizations, `Visualizer.tsx` needs to transition from listening to a low-rate Max amplitude scalar to processing Web Audio API arrays. By utilizing an `AnalyserNode` and transmitting the data via `BroadcastChannel` (when using the detached Studio), we can achieve high-fidelity, high-framerate visuals with minimal impact on Max for Live's performance. The React component can then be updated to include a toggle to switch between the Oscilloscope, Sonogram, and Spectrogram canvas drawing modes.
