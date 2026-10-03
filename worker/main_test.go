package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		job     Job
		wantErr bool
	}{
		{name: "missing kind", job: Job{InputFile: "input.mp4"}, wantErr: true},
		{name: "missing input", job: Job{Kind: "crop"}, wantErr: true},
		{name: "merge needs two files", job: Job{Kind: "merge", InputFiles: []string{"one.mp4"}, OutputFile: "merged.mp4"}, wantErr: true},
		{name: "valid crop", job: Job{Kind: "crop", InputFile: "input.mp4"}, wantErr: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validate(&test.job); (err != nil) != test.wantErr {
				t.Fatalf("validate() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}

func TestDefaultOutput(t *testing.T) {
	job := Job{Kind: "removeSilence"}
	got := defaultOutput(job, filepath.Join("videos", "movie.mp4"))
	want := "movie-nosilence.mp4"
	if got != want {
		t.Fatalf("defaultOutput() = %q, want %q", got, want)
	}
}

func TestCommandArgs(t *testing.T) {
	job := Job{Kind: "crop", Crop: Crop{X: 10, Y: 20, Width: 640, Height: 360}}
	args, err := commandArgs(job, "input.mp4", "output.mp4")
	if err != nil {
		t.Fatalf("commandArgs() error = %v", err)
	}
	want := []string{"-y", "-i", "input.mp4", "-vf", "crop=640:360:10:20", "-c:a", "copy", "output.mp4"}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("commandArgs() = %#v, want %#v", args, want)
	}

	_, err = commandArgs(Job{Kind: "unknown"}, "input.mp4", "output.mp4")
	if err == nil || !strings.Contains(err.Error(), "unsupported operation") {
		t.Fatalf("unsupported operation error = %v", err)
	}
}

func TestMediaCommandArgs(t *testing.T) {
	convertArgs, err := commandArgs(Job{Kind: "convert", VideoCodec: "h264", VideoBitrate: "5M"}, "input.mov", "output.mp4")
	if err != nil || !containsArgs(convertArgs, "-c:v", "libx264", "-b:v", "5M") {
		t.Fatalf("convert commandArgs() = %#v, error = %v", convertArgs, err)
	}

	resizeArgs, err := commandArgs(Job{Kind: "resize", ResizeWidth: 1080, ResizeHeight: 1920}, "input.mp4", "output.mp4")
	if err != nil || !containsArgs(resizeArgs, "scale=1080:1920") {
		t.Fatalf("resize commandArgs() = %#v, error = %v", resizeArgs, err)
	}

	speedArgs, err := commandArgs(Job{Kind: "speed", Speed: 0.5}, "input.mp4", "output.mp4")
	if err != nil || !containsArgs(speedArgs, "setpts=PTS/0.500", "atempo=0.500") {
		t.Fatalf("speed commandArgs() = %#v, error = %v", speedArgs, err)
	}
}

func containsArgs(args []string, expected ...string) bool {
	joined := strings.Join(args, " ")
	for _, value := range expected {
		if !strings.Contains(joined, value) {
			return false
		}
	}
	return true
}

func TestMakeBatchOutputsAvoidsDuplicateNames(t *testing.T) {
	root := t.TempDir()
	inputs := []string{
		filepath.Join(root, "folder-a", "movie.mp4"),
		filepath.Join(root, "folder-b", "movie.mp4"),
	}
	job := Job{Kind: "crop", OutputDirectory: root}

	outputs := makeBatchOutputs(job, inputs)
	if len(outputs) != 2 {
		t.Fatalf("makeBatchOutputs() returned %d outputs, want 2", len(outputs))
	}
	if outputs[0] == outputs[1] {
		t.Fatalf("duplicate output paths: %q", outputs)
	}
	if !strings.Contains(filepath.Base(outputs[0]), "folder-a") || !strings.Contains(filepath.Base(outputs[1]), "folder-b") {
		t.Fatalf("outputs do not contain source folder names: %q", outputs)
	}

	if err := os.WriteFile(outputs[0], []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	next := makeBatchOutputs(job, inputs)[0]
	if next == outputs[0] {
		t.Fatalf("existing output was not suffixed: %q", next)
	}
	if !strings.Contains(filepath.Base(next), "-1") {
		t.Fatalf("expected numeric suffix in %q", next)
	}
}

func TestParseSilences(t *testing.T) {
	output := `[silencedetect @ 0x1] silence_start: 1.250
[silencedetect @ 0x1] silence_end: 3.500 | silence_duration: 2.250
[silencedetect @ 0x1] silence_start: 8.000
[silencedetect @ 0x1] silence_end: 9.125 | silence_duration: 1.125`

	got := parseSilences(output)
	want := []silenceRange{{start: 1.25, end: 3.5}, {start: 8, end: 9.125}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseSilences() = %#v, want %#v", got, want)
	}
}
