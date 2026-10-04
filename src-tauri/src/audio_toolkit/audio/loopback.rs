//! System audio ("what's playing on this PC") capture via WASAPI loopback.
//!
//! On WASAPI, cpal opens an *output* device's input stream in loopback mode,
//! so recording the default render endpoint captures everything being played,
//! e.g. the far side of a call. Other platforms have no equivalent in cpal, so
//! `start()` reports that the feature is unavailable there.

#[cfg(any(target_os = "windows", test))]
use cpal::{FromSample, Sample};

/// Output sample rate handed back by [`LoopbackCapture::stop`].
#[cfg(target_os = "windows")]
const TARGET_SAMPLE_RATE: usize = 16_000;

/// Hard cap on captured audio so a forgotten recording can't eat all memory.
#[cfg(target_os = "windows")]
const MAX_CAPTURE_SECONDS: usize = 10 * 60;

/// Average interleaved frames down to mono and append them to `out`, stopping
/// once `out` holds `max_len` samples. Returns `false` if anything was dropped.
#[cfg(any(target_os = "windows", test))]
fn downmix_into<T>(data: &[T], channels: usize, out: &mut Vec<f32>, max_len: usize) -> bool
where
    T: Sample,
    f32: FromSample<T>,
{
    let channels = channels.max(1);
    let mut complete = true;
    for frame in data.chunks_exact(channels) {
        if out.len() >= max_len {
            complete = false;
            break;
        }
        let sum: f32 = frame.iter().map(|&s| f32::from_sample(s)).sum();
        out.push(sum / channels as f32);
    }
    complete
}

#[cfg(target_os = "windows")]
pub use windows_impl::LoopbackCapture;

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::{
        sync::{mpsc, Arc, Mutex},
        thread::JoinHandle,
        time::Duration,
    };

    use cpal::{
        traits::{DeviceTrait, HostTrait, StreamTrait},
        FromSample, SizedSample,
    };

    use super::{downmix_into, MAX_CAPTURE_SECONDS, TARGET_SAMPLE_RATE};
    use crate::audio_toolkit::audio::FrameResampler;

    /// Records the default output device until [`stop`](Self::stop) is called.
    ///
    /// The cpal stream is not `Send`, so it lives on a dedicated thread; this
    /// handle only owns the thread, its stop channel and the shared buffer.
    pub struct LoopbackCapture {
        stop_tx: mpsc::Sender<()>,
        worker: JoinHandle<()>,
        samples: Arc<Mutex<Vec<f32>>>,
        sample_rate: u32,
    }

    impl LoopbackCapture {
        /// Start capturing the default output device via WASAPI loopback.
        pub fn start() -> Result<Self, String> {
            let samples = Arc::new(Mutex::new(Vec::new()));
            let (stop_tx, stop_rx) = mpsc::channel::<()>();
            let (init_tx, init_rx) = mpsc::sync_channel::<Result<u32, String>>(1);

            let thread_samples = Arc::clone(&samples);
            let worker = std::thread::Builder::new()
                .name("loopback-capture".into())
                .spawn(move || {
                    let stream = match build_loopback_stream(thread_samples) {
                        Ok((stream, sample_rate)) => {
                            let _ = init_tx.send(Ok(sample_rate));
                            stream
                        }
                        Err(e) => {
                            let _ = init_tx.send(Err(e));
                            return;
                        }
                    };
                    // Block until stop() is called or the handle is dropped
                    // (which disconnects the channel); the stream drops here.
                    let _ = stop_rx.recv();
                    if let Err(e) = stream.pause() {
                        log::debug!("Failed to pause loopback stream: {e}");
                    }
                    drop(stream);
                })
                .map_err(|e| format!("Failed to spawn loopback capture thread: {e}"))?;

            let sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(rate)) => rate,
                Ok(Err(e)) => {
                    let _ = worker.join();
                    return Err(e);
                }
                Err(_) => {
                    // The thread is stuck in device setup; ask it to quit and
                    // don't block on it.
                    let _ = stop_tx.send(());
                    return Err("Timed out starting system audio capture".into());
                }
            };

            Ok(Self {
                stop_tx,
                worker,
                samples,
                sample_rate,
            })
        }

        /// Stop capture and return everything recorded as 16 kHz mono f32.
        pub fn stop(self) -> Result<Vec<f32>, String> {
            let _ = self.stop_tx.send(());
            self.worker
                .join()
                .map_err(|_| "System audio capture thread panicked".to_string())?;

            let captured = std::mem::take(
                &mut *self
                    .samples
                    .lock()
                    .map_err(|_| "System audio buffer was poisoned".to_string())?,
            );
            log::info!(
                "System audio capture stopped: {} samples at {} Hz ({:.1}s)",
                captured.len(),
                self.sample_rate,
                captured.len() as f32 / self.sample_rate.max(1) as f32
            );

            if captured.is_empty() {
                return Ok(captured);
            }
            Ok(resample_to_target(&captured, self.sample_rate as usize))
        }
    }

    /// Open the default output device in loopback mode and start it playing.
    fn build_loopback_stream(samples: Arc<Mutex<Vec<f32>>>) -> Result<(cpal::Stream, u32), String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "No output device found for system audio capture".to_string())?;
        let config = device
            .default_output_config()
            .map_err(|e| format!("Failed to read output device config: {e}"))?;

        let sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        log::info!(
            "System audio capture from {:?}: {} Hz, {} channels, {:?}",
            device.name(),
            sample_rate,
            channels,
            config.sample_format()
        );

        let max_len = sample_rate as usize * MAX_CAPTURE_SECONDS;
        let stream_config: cpal::StreamConfig = config.clone().into();
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                build_stream::<f32>(&device, &stream_config, channels, max_len, samples)
            }
            cpal::SampleFormat::I16 => {
                build_stream::<i16>(&device, &stream_config, channels, max_len, samples)
            }
            cpal::SampleFormat::I32 => {
                build_stream::<i32>(&device, &stream_config, channels, max_len, samples)
            }
            cpal::SampleFormat::U16 => {
                build_stream::<u16>(&device, &stream_config, channels, max_len, samples)
            }
            other => return Err(format!("Unsupported output sample format: {other:?}")),
        }
        .map_err(|e| format!("Failed to open system audio loopback stream: {e}"))?;

        stream
            .play()
            .map_err(|e| format!("Failed to start system audio capture: {e}"))?;
        Ok((stream, sample_rate))
    }

    fn build_stream<T>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        channels: usize,
        max_len: usize,
        samples: Arc<Mutex<Vec<f32>>>,
    ) -> Result<cpal::Stream, cpal::BuildStreamError>
    where
        T: SizedSample + Send + 'static,
        f32: FromSample<T>,
    {
        let mut cap_logged = false;
        device.build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                // Only stop() contends for this lock, once, so holding it in
                // the callback is fine.
                if let Ok(mut buf) = samples.lock() {
                    if !downmix_into(data, channels, &mut buf, max_len)
                        && !cap_logged
                    {
                        cap_logged = true;
                        log::warn!(
                            "System audio capture hit the {MAX_CAPTURE_SECONDS}s cap; dropping further audio"
                        );
                    }
                }
            },
            |err| log::error!("System audio capture stream error: {err}"),
            None,
        )
    }

    fn resample_to_target(input: &[f32], in_hz: usize) -> Vec<f32> {
        if in_hz == TARGET_SAMPLE_RATE {
            return input.to_vec();
        }
        let mut resampler =
            FrameResampler::new(in_hz, TARGET_SAMPLE_RATE, Duration::from_millis(30));
        let mut out = Vec::with_capacity(input.len() * TARGET_SAMPLE_RATE / in_hz + 1024);
        resampler.push(input, |frame| out.extend_from_slice(frame));
        resampler.finish(|frame| out.extend_from_slice(frame));
        out
    }
}

/// Stub for platforms without loopback capture; [`start`](Self::start) always fails.
#[cfg(not(target_os = "windows"))]
pub struct LoopbackCapture {
    _private: (),
}

#[cfg(not(target_os = "windows"))]
impl LoopbackCapture {
    /// Start capturing the default output device via WASAPI loopback.
    pub fn start() -> Result<Self, String> {
        Err("System audio capture is only available on Windows for now".into())
    }

    /// Stop capture and return everything recorded as 16 kHz mono f32.
    pub fn stop(self) -> Result<Vec<f32>, String> {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_downmix_averages_channels() {
        let mut out = Vec::new();
        let complete = downmix_into(&[1.0f32, 0.0, 0.5, 0.5, -1.0, 1.0], 2, &mut out, 100);
        assert!(complete);
        assert_eq!(out, vec![0.5, 0.5, 0.0]);
    }

    #[test]
    fn loopback_downmix_converts_integer_samples() {
        let mut out = Vec::new();
        downmix_into(&[i16::MAX, i16::MAX, 0i16, 0], 2, &mut out, 100);
        assert_eq!(out.len(), 2);
        assert!((out[0] - 1.0).abs() < 1e-3);
        assert_eq!(out[1], 0.0);
    }

    #[test]
    fn loopback_downmix_respects_cap() {
        let mut out = vec![0.0; 2];
        let complete = downmix_into(&[1.0f32; 8], 1, &mut out, 5);
        assert!(!complete);
        assert_eq!(out.len(), 5);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn loopback_start_fails_off_windows() {
        assert!(LoopbackCapture::start().is_err());
    }
}
