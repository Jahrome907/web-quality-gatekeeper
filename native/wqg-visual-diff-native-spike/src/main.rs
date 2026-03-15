use std::env;
use std::fs;
use std::process;
use std::time::Instant;

#[derive(Debug)]
struct Config {
    width: usize,
    height: usize,
    baseline_path: String,
    current_path: String,
    diff_out_path: Option<String>,
    threshold: f64,
}

fn usage() -> &'static str {
    "Usage: wqg-visual-diff-native-spike --width <px> --height <px> --baseline <path> --current <path> [--diff-out <path>] [--threshold <0..1>]\n\
     Inputs must be normalized RGBA byte buffers with length width*height*4."
}

fn parse_args(args: &[String]) -> Result<Config, String> {
    let mut width: Option<usize> = None;
    let mut height: Option<usize> = None;
    let mut baseline_path: Option<String> = None;
    let mut current_path: Option<String> = None;
    let mut diff_out_path: Option<String> = None;
    let mut threshold: f64 = 0.0;

    let mut i = 0usize;
    while i < args.len() {
        let flag = args[i].as_str();
        let next = args.get(i + 1);

        match flag {
            "--width" => {
                let value = next.ok_or_else(|| "Missing value for --width".to_string())?;
                width = Some(
                    value
                        .parse::<usize>()
                        .map_err(|_| format!("Invalid --width value: {value}"))?,
                );
                i += 2;
            }
            "--height" => {
                let value = next.ok_or_else(|| "Missing value for --height".to_string())?;
                height = Some(
                    value
                        .parse::<usize>()
                        .map_err(|_| format!("Invalid --height value: {value}"))?,
                );
                i += 2;
            }
            "--baseline" => {
                let value = next.ok_or_else(|| "Missing value for --baseline".to_string())?;
                baseline_path = Some(value.to_string());
                i += 2;
            }
            "--current" => {
                let value = next.ok_or_else(|| "Missing value for --current".to_string())?;
                current_path = Some(value.to_string());
                i += 2;
            }
            "--diff-out" => {
                let value = next.ok_or_else(|| "Missing value for --diff-out".to_string())?;
                diff_out_path = Some(value.to_string());
                i += 2;
            }
            "--threshold" => {
                let value = next.ok_or_else(|| "Missing value for --threshold".to_string())?;
                let parsed = value
                    .parse::<f64>()
                    .map_err(|_| format!("Invalid --threshold value: {value}"))?;
                if !(0.0..=1.0).contains(&parsed) {
                    return Err(format!(
                        "Invalid --threshold value: {value}. Expected a number between 0 and 1."
                    ));
                }
                threshold = parsed;
                i += 2;
            }
            "--help" | "-h" => {
                return Err(usage().to_string());
            }
            _ => {
                return Err(format!("Unknown argument: {flag}\n{}", usage()));
            }
        }
    }

    let width = width.ok_or_else(|| "Missing required --width".to_string())?;
    let height = height.ok_or_else(|| "Missing required --height".to_string())?;
    let baseline_path = baseline_path.ok_or_else(|| "Missing required --baseline".to_string())?;
    let current_path = current_path.ok_or_else(|| "Missing required --current".to_string())?;

    if width == 0 || height == 0 {
        return Err("Width and height must be greater than zero".to_string());
    }

    Ok(Config {
        width,
        height,
        baseline_path,
        current_path,
        diff_out_path,
        threshold,
    })
}

fn expected_rgba_len(width: usize, height: usize) -> Result<usize, String> {
    width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Image dimensions overflowed size calculation".to_string())
}

fn channel_delta_exceeds_threshold(
    baseline: &[u8],
    current: &[u8],
    offset: usize,
    threshold: f64,
) -> bool {
    let d0 = (baseline[offset] as i16 - current[offset] as i16).unsigned_abs() as f64 / 255.0;
    let d1 =
        (baseline[offset + 1] as i16 - current[offset + 1] as i16).unsigned_abs() as f64 / 255.0;
    let d2 =
        (baseline[offset + 2] as i16 - current[offset + 2] as i16).unsigned_abs() as f64 / 255.0;
    let d3 =
        (baseline[offset + 3] as i16 - current[offset + 3] as i16).unsigned_abs() as f64 / 255.0;
    d0 > threshold || d1 > threshold || d2 > threshold || d3 > threshold
}

fn run(config: Config) -> Result<(), String> {
    let start = Instant::now();
    let expected_len = expected_rgba_len(config.width, config.height)?;

    let baseline = fs::read(&config.baseline_path)
        .map_err(|error| format!("Failed to read baseline RGBA buffer: {error}"))?;
    let current = fs::read(&config.current_path)
        .map_err(|error| format!("Failed to read current RGBA buffer: {error}"))?;

    if baseline.len() != expected_len {
        return Err(format!(
            "Baseline RGBA length mismatch. Expected {expected_len}, got {}",
            baseline.len()
        ));
    }
    if current.len() != expected_len {
        return Err(format!(
            "Current RGBA length mismatch. Expected {expected_len}, got {}",
            current.len()
        ));
    }

    let pixel_count = config.width * config.height;
    let mut diff_pixels = 0usize;
    let mut diff_buffer = config
        .diff_out_path
        .as_ref()
        .map(|_| vec![0u8; expected_len]);
    for i in 0..pixel_count {
        let offset = i * 4;
        if channel_delta_exceeds_threshold(&baseline, &current, offset, config.threshold) {
            diff_pixels += 1;
            if let Some(buffer) = diff_buffer.as_mut() {
                buffer[offset] = 255;
                buffer[offset + 3] = 255;
            }
        }
    }

    if let Some(diff_out_path) = config.diff_out_path.as_ref() {
        let buffer = diff_buffer
            .take()
            .ok_or_else(|| "Internal error: diff buffer was not initialized".to_string())?;
        fs::write(diff_out_path, buffer)
            .map_err(|error| format!("Failed to write diff RGBA buffer: {error}"))?;
    }

    let mismatch_ratio = diff_pixels as f64 / pixel_count as f64;
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    println!(
        "{{\"engine\":\"wqg-native-spike\",\"width\":{},\"height\":{},\"pixelCount\":{},\"diffPixels\":{},\"comparablePixels\":{},\"mismatchRatio\":{:.8},\"threshold\":{:.8},\"elapsedMs\":{:.3}}}",
        config.width,
        config.height,
        pixel_count,
        diff_pixels,
        pixel_count,
        mismatch_ratio,
        config.threshold,
        elapsed_ms
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match parse_args(&args).and_then(run) {
        Ok(()) => {}
        Err(message) => {
            eprintln!("{message}");
            process::exit(2);
        }
    }
}
