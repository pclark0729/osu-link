//! System / loopback audio spectrum for the header visualizer.
//! Uses the default **output** device as a capture source (loopback): Windows WASAPI and
//! macOS CoreAudio expose this so we visualize what is playing on the system mix.

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    SampleFormat, StreamConfig,
};
use realfft::{num_complex::Complex, RealFftPlanner};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const FFT_SIZE: usize = 2048;
const BANDS: usize = 64;
const F_MIN: f32 = 35.0;
const F_MAX_CAP: f32 = 16_000.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioVizPayload {
    pub levels: Vec<f32>,
}

fn hann_window(buf: &mut [f32]) {
    let n = buf.len();
    if n < 2 {
        return;
    }
    let denom = (n - 1) as f32;
    for (i, x) in buf.iter_mut().enumerate() {
        let w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / denom).cos());
        *x *= w;
    }
}

fn log_band_range(
    band: usize,
    bands: usize,
    spectrum_len: usize,
    sample_rate: f32,
) -> (usize, usize) {
    let nyquist = sample_rate * 0.5;
    let f_max = nyquist.min(F_MAX_CAP).max(F_MIN * 2.0);
    let t0 = band as f32 / bands as f32;
    let t1 = (band + 1) as f32 / bands as f32;
    let f_low = F_MIN * (f_max / F_MIN).powf(t0);
    let f_high = F_MIN * (f_max / F_MIN).powf(t1);
    let k0 = ((f_low * FFT_SIZE as f32 / sample_rate).floor() as usize).clamp(1, spectrum_len.saturating_sub(2));
    let k1 = ((f_high * FFT_SIZE as f32 / sample_rate).ceil() as usize)
        .max(k0 + 1)
        .min(spectrum_len - 1);
    (k0, k1)
}

fn spectrum_to_bands(
    spectrum: &[Complex<f32>],
    sample_rate: f32,
    smooth: &mut [f32; BANDS],
    peak_env: &mut f32,
) -> Vec<f32> {
    let spectrum_len = spectrum.len();
    let mut raw = Vec::with_capacity(BANDS);
    for b in 0..BANDS {
        let (k0, k1) = log_band_range(b, BANDS, spectrum_len, sample_rate);
        let mut sum = 0f32;
        let mut n = 0u32;
        for k in k0..=k1.min(spectrum_len - 1) {
            sum += spectrum[k].norm();
            n += 1;
        }
        let v = if n > 0 { sum / n as f32 } else { 0.0 };
        smooth[b] = smooth[b] * 0.30 + v * 0.70;
        raw.push(smooth[b]);
    }
    let frame_max = raw.iter().cloned().fold(0f32, f32::max);
    if frame_max > *peak_env {
        *peak_env = *peak_env * 0.80 + frame_max * 0.20;
    } else {
        *peak_env = *peak_env * 0.988 + frame_max * 0.012;
    }
    *peak_env = peak_env.max(1e-7);
    let inv = 1.0 / peak_env.max(1e-4);
    raw.into_iter()
        .map(|x| (x * inv).min(1.0).powf(0.52))
        .collect()
}

fn push_mono(samples: &[f32], ch: usize, buf: &Arc<Mutex<Vec<f32>>>) {
    if ch == 0 {
        return;
    }
    let mono: Vec<f32> = samples
        .chunks_exact(ch)
        .map(|chunk| chunk.iter().copied().sum::<f32>() / ch as f32)
        .collect();
    let mut g = buf.lock().expect("audio viz buffer");
    g.extend(mono);
    const MAX_KEEP: usize = 48_000 * 3;
    if g.len() > MAX_KEEP {
        let excess = g.len() - MAX_KEEP;
        g.drain(0..excess);
    }
}

fn push_mono_i16(samples: &[i16], ch: usize, buf: &Arc<Mutex<Vec<f32>>>) {
    if ch == 0 {
        return;
    }
    let mono: Vec<f32> = samples
        .chunks_exact(ch)
        .map(|chunk| chunk.iter().map(|&s| s as f32 / 32768.0).sum::<f32>() / ch as f32)
        .collect();
    let mut g = buf.lock().expect("audio viz buffer");
    g.extend(mono);
    const MAX_KEEP: usize = 48_000 * 3;
    if g.len() > MAX_KEEP {
        let excess = g.len() - MAX_KEEP;
        g.drain(0..excess);
    }
}

/// Spawn loopback capture + spectrum analysis; emits `audio-viz` events to the webview.
pub fn spawn_audio_viz(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(e) = run_loopback(&app) {
            eprintln!("audio-viz: loopback unavailable ({e})");
        }
    });
}

fn run_loopback(app: &AppHandle) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "no default output device".to_string())?;

    let supported = device
        .default_output_config()
        .map_err(|e| e.to_string())?;
    let sample_rate = supported.sample_rate() as f32;
    let sample_format = supported.sample_format();
    let config: StreamConfig = supported.into();
    let channels = config.channels as usize;

    let shared = Arc::new(Mutex::new(Vec::<f32>::new()));
    let shared_cb = Arc::clone(&shared);

    let stream = match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _| push_mono(data, channels, &shared_cb),
            |e| eprintln!("audio-viz stream: {e}"),
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _| push_mono_i16(data, channels, &shared_cb),
            |e| eprintln!("audio-viz stream: {e}"),
            None,
        ),
        SampleFormat::I32 => device.build_input_stream(
            &config,
            move |data: &[i32], _| {
                let v: Vec<f32> = data
                    .chunks_exact(channels)
                    .map(|chunk| {
                        chunk.iter().map(|&s| s as f32 / 2_147_483_648.0).sum::<f32>() / channels as f32
                    })
                    .collect();
                push_mono(&v, 1, &shared_cb);
            },
            |e| eprintln!("audio-viz stream: {e}"),
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _| {
                let v: Vec<f32> = data
                    .chunks_exact(channels)
                    .map(|chunk| {
                        chunk
                            .iter()
                            .map(|&s| (s as f32 / 32768.0) - 1.0)
                            .sum::<f32>()
                            / channels as f32
                    })
                    .collect();
                push_mono(&v, 1, &shared_cb);
            },
            |e| eprintln!("audio-viz stream: {e}"),
            None,
        ),
        SampleFormat::F64 => device.build_input_stream(
            &config,
            move |data: &[f64], _| {
                let v: Vec<f32> = data
                    .chunks_exact(channels)
                    .map(|chunk| chunk.iter().map(|&s| s as f32).sum::<f32>() / channels as f32)
                    .collect();
                push_mono(&v, 1, &shared_cb);
            },
            |e| eprintln!("audio-viz stream: {e}"),
            None,
        ),
        _ => {
            return Err(format!("unsupported sample format: {sample_format:?}"));
        }
    }
    .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;

    let mut planner = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(FFT_SIZE);
    let mut indata = r2c.make_input_vec();
    let mut spectrum = r2c.make_output_vec();
    let mut smooth = [0f32; BANDS];
    let mut peak_env = 0.08f32;

    let mut last_emit = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(10));

        {
            let g = shared.lock().expect("audio viz buffer");
            if g.len() < FFT_SIZE {
                continue;
            }
            let start = g.len() - FFT_SIZE;
            indata.copy_from_slice(&g[start..]);
        }

        hann_window(&mut indata);
        if let Err(e) = r2c.process(&mut indata, &mut spectrum) {
            eprintln!("audio-viz fft: {e}");
            continue;
        }

        let levels = spectrum_to_bands(&spectrum, sample_rate, &mut smooth, &mut peak_env);

        if last_emit.elapsed() < Duration::from_millis(8) {
            continue;
        }
        last_emit = Instant::now();

        if app.emit("audio-viz", &AudioVizPayload { levels }).is_err() {
            break;
        }
    }

    Ok(())
}
