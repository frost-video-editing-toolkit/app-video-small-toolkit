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
	return len(inputs) > 1 && (kind == "crop" || kind == "trim" || kind == "removeSilence")
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
	default:
		return nil, fmt.Errorf("unsupported operation: %s", job.Kind)
	}
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
	if job.Kind == "removeSilence" {
		suffix = "nosilence"
	}
	return fmt.Sprintf("%s-%s%s", base, suffix, filepath.Ext(input))
}

func trimPattern(input string) string {
	return strings.TrimSuffix(filepath.Base(input), filepath.Ext(input)) + "-trim-%03d.mp4"
}

func isVideo(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".mp4" || ext == ".mov" || ext == ".mkv" || ext == ".avi" || ext == ".webm"
}
