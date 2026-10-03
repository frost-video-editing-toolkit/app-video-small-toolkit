package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

type Job struct {
	Kind               string   `json:"kind"`
	InputFile          string   `json:"inputFile"`
	InputFiles         []string `json:"inputFiles"`
	InputDirectory     string   `json:"inputDirectory"`
	OutputFile         string   `json:"outputFile"`
	OutputDirectory    string   `json:"outputDirectory"`
	StartTime          string   `json:"startTime"`
	EndTime            string   `json:"endTime"`
	SplitInterval      string   `json:"splitInterval"`
	RepeatCount        int      `json:"repeatCount"`
	Crop               Crop     `json:"crop"`
	NoiseThresholdDb   float64  `json:"noiseThresholdDb"`
	MinSilenceDuration float64  `json:"minSilenceDuration"`
	OutputFormat       string   `json:"outputFormat"`
	VideoCodec         string   `json:"videoCodec"`
	VideoBitrate       string   `json:"videoBitrate"`
	ResizePreset       string   `json:"resizePreset"`
	ResizeWidth        int      `json:"resizeWidth"`
	ResizeHeight       int      `json:"resizeHeight"`
	AudioVolume        float64  `json:"audioVolume"`
	BgmFile            string   `json:"bgmFile"`
	Speed              float64  `json:"speed"`
	SubtitleFile       string   `json:"subtitleFile"`
	SubtitleText       string   `json:"subtitleText"`
	SubtitlePosition   string   `json:"subtitlePosition"`
	SubtitleFontSize   int      `json:"subtitleFontSize"`
	SubtitleColor      string   `json:"subtitleColor"`
	LogoFile           string   `json:"logoFile"`
	WatermarkX         int      `json:"watermarkX"`
	WatermarkY         int      `json:"watermarkY"`
	WatermarkOpacity   float64  `json:"watermarkOpacity"`
	ThumbnailTime      string   `json:"thumbnailTime"`
	ThumbnailInterval  float64  `json:"thumbnailInterval"`
	ThumbnailCount     int      `json:"thumbnailCount"`
}

type Crop struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type Event struct {
	Type       string  `json:"type"`
	Success    bool    `json:"success,omitempty"`
	Operation  string  `json:"operation,omitempty"`
	OutputFile string  `json:"outputFile,omitempty"`
	Error      string  `json:"error,omitempty"`
	Message    string  `json:"message,omitempty"`
	Percent    float64 `json:"percent,omitempty"`
	Status     string  `json:"status,omitempty"`
}

var encoder = json.NewEncoder(os.Stdout)
var encoderMu sync.Mutex

func emit(event Event) {
	encoderMu.Lock()
	defer encoderMu.Unlock()
	_ = encoder.Encode(event)
}

func main() {
	var job Job
	if err := json.NewDecoder(bufio.NewReader(os.Stdin)).Decode(&job); err != nil {
		emit(Event{Type: "result", Error: fmt.Sprintf("invalid job: %v", err)})
		os.Exit(1)
	}

	if err := validate(&job); err != nil {
		emit(Event{Type: "result", Error: err.Error()})
		os.Exit(1)
	}

	if err := run(job); err != nil {
		emit(Event{Type: "result", Error: err.Error()})
		os.Exit(1)
	}
	emit(Event{Type: "progress", Operation: job.Kind, Percent: 100, Status: "completed"})
	emit(Event{Type: "result", Success: true, Operation: job.Kind})
}

func validate(job *Job) error {
	if job.Kind == "" {
		return errors.New("kind is required")
	}
	if job.InputFile == "" && len(job.InputFiles) == 0 && job.InputDirectory == "" {
		return errors.New("at least one input is required")
	}
	if job.Kind == "merge" && len(job.InputFiles) < 2 {
		return errors.New("merge requires at least two input files")
	}
	if job.Kind == "convert" && !isOutputFormat(job.OutputFormat) {
		return fmt.Errorf("unsupported output format: %s", job.OutputFormat)
	}
	if job.Kind == "resize" && (job.ResizeWidth <= 0 || job.ResizeHeight <= 0) {
		return errors.New("resize dimensions must be positive")
	}
	if job.Kind == "speed" && job.Speed <= 0 {
		return errors.New("speed must be positive")
	}
	if job.Kind == "addBgm" && job.BgmFile == "" {
		return errors.New("bgm file is required")
	}
	if job.Kind == "subtitles" && job.SubtitleFile == "" && job.SubtitleText == "" {
		return errors.New("subtitle file or text is required")
	}
	if job.Kind == "watermark" && job.LogoFile == "" {
		return errors.New("logo file is required")
	}
	if (job.Kind == "thumbnails" || job.Kind == "contactSheet") && job.ThumbnailInterval <= 0 {
		return errors.New("thumbnail interval must be positive")
	}
	if job.Kind == "thumbnails" && job.ThumbnailCount <= 0 {
		return errors.New("thumbnail count must be positive")
	}
	return nil
}

func run(job Job) error {
	if job.Kind == "merge" {
		return runMerge(job)
	}

	inputs := collectInputs(job)
	if len(inputs) == 0 {
		return errors.New("no supported video inputs found")
	}

	if isBatch(job.Kind, inputs) {
		workers := runtime.NumCPU()
		if workers > len(inputs) {
			workers = len(inputs)
		}
		return runBatch(job, inputs, workers)
	}

	output := job.OutputFile
	if output == "" {
		output = defaultOutput(job, inputs[0])
		if job.OutputDirectory != "" {
			output = filepath.Join(job.OutputDirectory, output)
		}
	}
	return runOne(job, inputs[0], output)
}

func collectInputs(job Job) []string {
	inputs := append([]string{}, job.InputFiles...)
	if job.InputFile != "" {
		inputs = append(inputs, job.InputFile)
	}
	if job.InputDirectory != "" {
		entries, _ := os.ReadDir(job.InputDirectory)
		for _, entry := range entries {
			if entry.IsDir() || !isVideo(entry.Name()) {
				continue
			}
			inputs = append(inputs, filepath.Join(job.InputDirectory, entry.Name()))
		}
	}
	return inputs
}

func isBatch(kind string, inputs []string) bool {
	return len(inputs) > 1 && (kind == "crop" || kind == "trim" || kind == "removeSilence" || kind == "convert" || kind == "resize" || kind == "volume" || kind == "removeAudio" || kind == "normalizeAudio" || kind == "speed" || kind == "thumbnail")
}

func runBatch(job Job, inputs []string, workers int) error {
	type batchItem struct {
		input  string
		output string
	}
	jobs := make(chan batchItem)
	errs := make(chan error, len(inputs))
	completed := 0
	var completedMu sync.Mutex
	var group sync.WaitGroup
	outputs := makeBatchOutputs(job, inputs)
	for i := 0; i < workers; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for item := range jobs {
				if err := runOneWithProgress(job, item.input, item.output, false); err != nil {
					errs <- err
					continue
				}
				completedMu.Lock()
				completed++
				done := completed
				percent := float64(done) / float64(len(inputs)) * 100
				completedMu.Unlock()
				emit(Event{Type: "progress", Operation: job.Kind, Percent: percent, Status: "running", Message: fmt.Sprintf("Completed %d/%d", done, len(inputs))})
			}
		}()
	}
	for index, input := range inputs {
		jobs <- batchItem{input: input, output: outputs[index]}
	}
	close(jobs)
	group.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

func makeBatchOutputs(job Job, inputs []string) []string {
	baseCounts := make(map[string]int)
	for _, input := range inputs {
		baseCounts[strings.ToLower(filepath.Base(input))]++
	}

	used := make(map[string]bool)
	outputs := make([]string, 0, len(inputs))
	for _, input := range inputs {
		name := defaultOutput(job, input)
		if baseCounts[strings.ToLower(filepath.Base(input))] > 1 {
			parent := filepath.Base(filepath.Dir(input))
			name = parent + "-" + name
		}

		output := name
		if job.OutputDirectory != "" {
			output = filepath.Join(job.OutputDirectory, name)
		}
		candidate := output
		for suffix := 1; used[strings.ToLower(candidate)] || fileExists(candidate); suffix++ {
			base, ext := splitExtension(output)
			candidate = fmt.Sprintf("%s-%d%s", base, suffix, ext)
		}
		used[strings.ToLower(candidate)] = true
		outputs = append(outputs, candidate)
	}
	return outputs
}

func splitExtension(path string) (string, string) {
	ext := filepath.Ext(path)
	return strings.TrimSuffix(path, ext), ext
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func runOne(job Job, input, output string) error {
	return runOneWithProgress(job, input, output, true)
}

func runOneWithProgress(job Job, input, output string, emitCompletion bool) error {
	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil && filepath.Dir(output) != "." {
		return err
	}
	args, err := commandArgs(job, input, output)
	if err != nil {
		return err
	}
	emit(Event{Type: "started", Operation: job.Kind, OutputFile: output})
	emit(Event{Type: "progress", Operation: job.Kind, OutputFile: output, Percent: 0, Status: "running"})
	if job.Kind == "removeSilence" {
		if err := runRemoveSilence(job, input, output); err != nil {
			return fmt.Errorf("%s: %w", job.Kind, err)
		}
		completedEvent := Event{Type: "completed", Operation: job.Kind, OutputFile: output, Status: "completed"}
		if emitCompletion {
			completedEvent.Percent = 100
		}
		emit(completedEvent)
		return nil
	}
	if err := executeFFmpeg(args); err != nil {
		return fmt.Errorf("%s: %w", job.Kind, err)
	}
	completedEvent := Event{Type: "completed", Operation: job.Kind, OutputFile: output, Status: "completed"}
	if emitCompletion {
		completedEvent.Percent = 100
	}
	emit(completedEvent)
	return nil
}

func commandArgs(job Job, input, output string) ([]string, error) {
	switch job.Kind {
	case "crop":
		return []string{"-y", "-i", input, "-vf", fmt.Sprintf("crop=%d:%d:%d:%d", job.Crop.Width, job.Crop.Height, job.Crop.X, job.Crop.Y), "-c:a", "copy", output}, nil
	case "cut":
		return []string{"-y", "-ss", job.StartTime, "-i", input, "-to", job.EndTime, "-c", "copy", output}, nil
	case "loop":
		count := job.RepeatCount - 1
		if count < 0 {
			count = 0
		}
		return []string{"-y", "-stream_loop", fmt.Sprint(count), "-i", input, "-c", "copy", output}, nil
	case "removeSilence":
		return nil, nil
	case "trim":
		return []string{"-y", "-i", input, "-map", "0", "-c", "copy", "-f", "segment", "-segment_time", job.SplitInterval, "-reset_timestamps", "1", filepath.Join(job.OutputDirectory, trimPattern(input))}, nil
	case "convert":
		codec, err := videoCodec(job.VideoCodec)
		if err != nil {
			return nil, err
		}
		return []string{"-y", "-i", input, "-c:v", codec, "-b:v", defaultBitrate(job.VideoBitrate), "-c:a", "aac", "-movflags", "+faststart", output}, nil
	case "resize":
		if job.ResizeWidth <= 0 || job.ResizeHeight <= 0 {
			return nil, errors.New("resize dimensions must be positive")
		}
		return []string{"-y", "-i", input, "-vf", fmt.Sprintf("scale=%d:%d", job.ResizeWidth, job.ResizeHeight), "-c:v", "libx264", "-c:a", "aac", output}, nil
	case "volume":
		return []string{"-y", "-i", input, "-af", fmt.Sprintf("volume=%.3f", job.AudioVolume), "-c:v", "copy", "-c:a", "aac", output}, nil
	case "extractAudio":
		return []string{"-y", "-i", input, "-vn", "-c:a", "libmp3lame", output}, nil
	case "removeAudio":
		return []string{"-y", "-i", input, "-an", "-c:v", "copy", output}, nil
	case "normalizeAudio":
		return []string{"-y", "-i", input, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:v", "copy", "-c:a", "aac", output}, nil
	case "addBgm":
		return []string{"-y", "-i", input, "-stream_loop", "-1", "-i", job.BgmFile, "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", output}, nil
	case "speed":
		if job.Speed <= 0 {
			return nil, errors.New("speed must be positive")
		}
		return []string{"-y", "-i", input, "-vf", fmt.Sprintf("setpts=PTS/%.3f", job.Speed), "-af", atempoFilter(job.Speed), "-c:v", "libx264", "-c:a", "aac", output}, nil
	case "subtitles":
		filter := ""
		if job.SubtitleFile != "" {
			filter = fmt.Sprintf("subtitles='%s'", escapeFilterPath(job.SubtitleFile))
		} else {
			position := job.SubtitlePosition
			if position == "" {
				position = "bottom"
			}
			y := "h-th-40"
			if position == "top" {
				y = "40"
			} else if position == "middle" {
				y = "(h-th)/2"
			}
			size := job.SubtitleFontSize
			if size <= 0 {
				size = 32
			}
			color := job.SubtitleColor
			if color == "" {
				color = "white"
			}
			filter = fmt.Sprintf("drawtext=text='%s':fontsize=%d:fontcolor=%s:x=(w-tw)/2:y=%s:box=1:boxcolor=black@0.5", escapeFilterText(job.SubtitleText), size, color, y)
		}
		return []string{"-y", "-i", input, "-vf", filter, "-c:v", "libx264", "-c:a", "copy", output}, nil
	case "watermark":
		opacity := job.WatermarkOpacity
		if opacity <= 0 || opacity > 1 {
			opacity = 0.65
		}
		return []string{"-y", "-i", input, "-i", job.LogoFile, "-filter_complex", fmt.Sprintf("[1:v]format=rgba,colorchannelmixer=aa=%.3f[logo];[0:v][logo]overlay=%d:%d", opacity, job.WatermarkX, job.WatermarkY), "-c:v", "libx264", "-c:a", "copy", output}, nil
	case "thumbnail":
		return []string{"-y", "-ss", job.ThumbnailTime, "-i", input, "-frames:v", "1", "-q:v", "2", output}, nil
	case "thumbnails":
		base, ext := splitExtension(output)
		pattern := output
		if !strings.Contains(output, "%") {
			pattern = base + "-%03d" + ext
		}
		return []string{"-y", "-i", input, "-vf", fmt.Sprintf("fps=1/%.3f", job.ThumbnailInterval), "-frames:v", fmt.Sprint(job.ThumbnailCount), "-q:v", "2", pattern}, nil
	case "contactSheet":
		return []string{"-y", "-i", input, "-vf", fmt.Sprintf("fps=1/%.3f,scale=320:-1,tile=4x4", job.ThumbnailInterval), "-frames:v", "1", "-q:v", "2", output}, nil
	default:
		return nil, fmt.Errorf("unsupported operation: %s", job.Kind)
	}
}

func atempoFilter(speed float64) string {
	filters := make([]string, 0, 4)
	for speed > 2 {
		filters = append(filters, "atempo=2.0")
		speed /= 2
	}
	for speed < 0.5 {
		filters = append(filters, "atempo=0.5")
		speed /= 0.5
	}
	filters = append(filters, fmt.Sprintf("atempo=%.3f", speed))
	return strings.Join(filters, ",")
}

func escapeFilterPath(value string) string {
	return strings.NewReplacer("\\", "\\\\", ":", "\\:", "'", "\\'").Replace(value)
}

func escapeFilterText(value string) string {
	return strings.NewReplacer("\\", "\\\\", ":", "\\:", "'", "\\'", "%", "\\%").Replace(value)
}

type silenceRange struct {
	start float64
	end   float64
}

func runRemoveSilence(job Job, input, output string) error {
	silences, err := detectSilences(input, job.NoiseThresholdDb, job.MinSilenceDuration)
	if err != nil {
		return err
	}
	if len(silences) == 0 {
		return executeFFmpeg([]string{"-y", "-i", input, "-c", "copy", output})
	}

	videoKeep := make([]string, 0, len(silences)+1)
	audioKeep := make([]string, 0, len(silences)+1)
	position := 0.0
	for _, silence := range silences {
		if silence.start > position {
			videoKeep = append(videoKeep, fmt.Sprintf("between(t,%.6f,%.6f)", position, silence.start))
			audioKeep = append(audioKeep, fmt.Sprintf("between(t,%.6f,%.6f)", position, silence.start))
		}
		position = silence.end
	}
	videoKeep = append(videoKeep, fmt.Sprintf("gte(t,%.6f)", position))
	audioKeep = append(audioKeep, fmt.Sprintf("gte(t,%.6f)", position))
	videoFilter := strings.Join(videoKeep, "+")
	audioFilter := strings.Join(audioKeep, "+")
	filter := fmt.Sprintf("[0:v]select='%s',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='%s',asetpts=N/SR/TB[a]", videoFilter, audioFilter)
	return executeFFmpeg([]string{"-y", "-i", input, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", output})
}

func detectSilences(input string, threshold float64, duration float64) ([]silenceRange, error) {
	path := os.Getenv("FFMPEG_PATH")
	if path == "" {
		path = "ffmpeg"
	}
	args := []string{"-hide_banner", "-i", input, "-af", fmt.Sprintf("silencedetect=noise=%.1fdB:d=%.3f", threshold, duration), "-f", "null", "-"}
	output, err := exec.Command(path, args...).CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			return nil, err
		}
	}
	return parseSilences(string(output)), nil
}

func parseSilences(output string) []silenceRange {
	startPattern := regexp.MustCompile(`silence_start: ([0-9.]+)`)
	endPattern := regexp.MustCompile(`silence_end: ([0-9.]+)`)
	var ranges []silenceRange
	var start *float64
	for _, line := range strings.Split(string(output), "\n") {
		if match := startPattern.FindStringSubmatch(line); len(match) == 2 {
			value, parseErr := strconv.ParseFloat(match[1], 64)
			if parseErr == nil {
				start = &value
			}
		}
		if match := endPattern.FindStringSubmatch(line); len(match) == 2 && start != nil {
			value, parseErr := strconv.ParseFloat(match[1], 64)
			if parseErr == nil && value > *start {
				ranges = append(ranges, silenceRange{start: *start, end: value})
			}
			start = nil
		}
	}
	return ranges
}

func runMerge(job Job) error {
	list, err := os.CreateTemp("", "video-workbench-*.txt")
	if err != nil {
		return err
	}
	defer os.Remove(list.Name())
	for _, input := range job.InputFiles {
		if _, err := fmt.Fprintf(list, "file '%s'\n", strings.ReplaceAll(input, "'", "'\\''")); err != nil {
			return err
		}
	}
	if err := list.Close(); err != nil {
		return err
	}
	output := job.OutputFile
	if output == "" {
		output = "merged.mp4"
	}
	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil && filepath.Dir(output) != "." {
		return err
	}
	emit(Event{Type: "started", Operation: job.Kind, OutputFile: output})
	if err := executeFFmpeg([]string{"-y", "-f", "concat", "-safe", "0", "-i", list.Name(), "-c", "copy", output}); err != nil {
		return err
	}
	emit(Event{Type: "completed", Operation: job.Kind, OutputFile: output})
	return nil
}

func executeFFmpeg(args []string) error {
	path := os.Getenv("FFMPEG_PATH")
	if path == "" {
		path = "ffmpeg"
	}
	cmd := exec.Command(path, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func defaultOutput(job Job, input string) string {
	base := strings.TrimSuffix(filepath.Base(input), filepath.Ext(input))
	suffix := job.Kind
	ext := filepath.Ext(input)
	if job.Kind == "removeSilence" {
		suffix = "nosilence"
	}
	if job.Kind == "convert" {
		suffix = "converted"
		ext = "." + job.OutputFormat
	}
	if job.Kind == "extractAudio" {
		suffix = "audio"
		ext = ".mp3"
	}
	if job.Kind == "thumbnail" || job.Kind == "contactSheet" {
		suffix = "thumbnail"
		ext = ".jpg"
	}
	if job.Kind == "thumbnails" {
		suffix = "thumbnail-%03d"
		ext = ".jpg"
	}
	return fmt.Sprintf("%s-%s%s", base, suffix, ext)
}

func isOutputFormat(format string) bool {
	return format == "mp4" || format == "mov" || format == "webm" || format == "mkv"
}

func videoCodec(codec string) (string, error) {
	switch codec {
	case "h264", "":
		return "libx264", nil
	case "h265":
		return "libx265", nil
	case "vp9":
		return "libvpx-vp9", nil
	default:
		return "", fmt.Errorf("unsupported video codec: %s", codec)
	}
}

func defaultBitrate(bitrate string) string {
	if bitrate == "" {
		return "5M"
	}
	return bitrate
}

func trimPattern(input string) string {
	return strings.TrimSuffix(filepath.Base(input), filepath.Ext(input)) + "-trim-%03d.mp4"
}

func isVideo(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".mp4" || ext == ".mov" || ext == ".mkv" || ext == ".avi" || ext == ".webm"
}
