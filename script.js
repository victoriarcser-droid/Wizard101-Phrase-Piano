let audioCtx;

let saveDirectoryHandle = null;

const keys = document.querySelectorAll(".key");
const pianoRoll = document.getElementById("piano-roll");
const sustainIndicator = document.getElementById("sustain-indicator");

const recordBtn = document.getElementById("recordBtn");
const playBtn = document.getElementById("playBtn");
const stopBtn = document.getElementById("stopBtn");
const exportBtn = document.getElementById("exportBtn");
const siteBtn = document.getElementById("siteBtn");
const labelToggleBtn = document.getElementById("labelToggleBtn");
const setSaveFolderBtn = document.getElementById("setSaveFolderBtn");
const sheet = document.getElementById("sheet");
const exportModal = document.getElementById("exportModal");
const songNameInput = document.getElementById("songNameInput");
const confirmExportBtn = document.getElementById("confirmExportBtn");
const cancelExportBtn = document.getElementById("cancelExportBtn");

let recordStart = 0;
let recordArmed = false;
let hasStartedRecording = false;

let songCounter = Number(localStorage.getItem("wizard101SongCounter")) || 1;

let songFolderHandle = null;

let sustain = false;
let activeNotes = new Map();
let sustainedNotes = new Set();

let recording = [];
let isRecording = false;
let isPlaying = false;
let noteStartTimes = {};

let playbackTimeouts = [];
let labelMode = "keys";

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    audioCtx.resume();
}

function updateSustainIndicator() {
    sustainIndicator.textContent = sustain ? "SUSTAIN: ON" : "SUSTAIN: OFF";
    sustainIndicator.style.background = sustain
        ? "rgba(80, 160, 255, 0.55)"
        : "rgba(0, 0, 0, 0.5)";
}

function playSaveSound() {
    const audio = document.getElementById("save-sound");
    if (!audio) return;

    audio.currentTime = 0;
    audio.volume = 1;

    audio.play().catch(err => {
        console.warn("Save sound failed:", err);
    });
}

function playSound(note) {
    getAudioContext();

    const audioEl = document.getElementById(note);

    if (!audioEl) {
        console.warn(`Missing audio element for note: ${note}`);
        return null;
    }

    const clone = audioEl.cloneNode(true);
    clone.currentTime = 0;
    clone.volume = 1;

    clone.play().catch(error => {
        console.warn(`Could not play ${note}:`, error);
    });

    return clone;
}

function showSaveNotification(text) {
    const el = document.createElement("div");
    el.textContent = text;

    el.style.position = "fixed";
    el.style.top = "20px";
    el.style.right = "40px";

    el.style.background = "rgba(20, 20, 20, 0.95)";
    el.style.color = "white";
    el.style.padding = "14px 18px";
    el.style.borderRadius = "10px";

    el.style.fontSize = "28px";
    el.style.fontWeight = "500";

    el.style.boxShadow = "0 8px 20px rgba(0,0,0,0.4)";
    el.style.zIndex = "9999";

    el.style.opacity = "0";
    el.style.transform = "translateY(-10px)";
    el.style.transition = "opacity 0.2s ease, transform 0.2s ease";

    document.body.appendChild(el);

    requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
    });

    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(-10px)";

        setTimeout(() => el.remove(), 200);
    }, 2200);
}

function stopSound(audio) {
    if (!audio) return;

    const fade = setInterval(() => {
        if (audio.volume > 0.05) {
            audio.volume *= 0.8;
        } else {
            audio.pause();
            audio.currentTime = 0;
            clearInterval(fade);
        }
    }, 20);
}

function fitPianoToScreen() {
    const piano = document.querySelector(".piano");

    const padding = 40; // breathing room
    const availableWidth = window.innerWidth - padding;

    const pianoWidth = piano.scrollWidth;

    const scale = Math.min(1, availableWidth / pianoWidth);

    piano.style.transform = `scale(${scale})`;
    piano.style.transformOrigin = "center center";
}

window.addEventListener("resize", fitPianoToScreen);
window.addEventListener("load", fitPianoToScreen);

function stopRecording() {
    isRecording = false;
    recordArmed = false;
    hasStartedRecording = false;

    recordBtn.textContent = "RECORD: OFF";
    recordBtn.classList.remove("recording");

    pianoRoll.classList.remove("recording");
}

async function restoreSaveFolder() {
    if (!localStorage.getItem("hasSaveFolder")) return;

    try {
        saveDirectoryHandle = await window.showDirectoryPicker();

        songFolderHandle = await saveDirectoryHandle.getDirectoryHandle(
            "Wizard101 Phrase Piano",
            { create: true }
        );
    } catch (err) {
        console.warn("Could not restore save folder:", err);
        saveDirectoryHandle = null;
    }
}

window.addEventListener("load", () => {
    fitPianoToScreen();
    restoreSaveFolder();
});
window.addEventListener("blur", stopRecording);

async function chooseSaveFolder() {
    saveDirectoryHandle = await window.showDirectoryPicker();

    await saveDirectoryHandle.requestPermission?.({ mode: "readwrite" });

    songFolderHandle = await saveDirectoryHandle.getDirectoryHandle(
        "Wizard101 Phrase Piano",
        { create: true }
    );

    localStorage.setItem("hasSaveFolder", "true");
}

async function setDefaultSaveFolder() {
    try {
        saveDirectoryHandle = await window.showDirectoryPicker();

        songFolderHandle = await saveDirectoryHandle.getDirectoryHandle(
            "Wizard101 Phrase Piano",
            { create: true }
        );

        // mark it as saved
        localStorage.setItem("hasSaveFolder", "true");

        showSaveNotification("Save Folder Equipped! ✔");
        playSaveSound?.(); 
    } catch (err) {
        console.warn("Folder selection cancelled or failed:", err);
    }
}

setSaveFolderBtn.onclick = setDefaultSaveFolder;


function createRollNote(keyEl, mode = "live") {
    const el = document.createElement("div");
    el.classList.add("roll-note");

    if (mode === "record") el.classList.add("recorded");
    if (mode === "playback") el.classList.add("played");
    if (mode === "live") el.classList.add("live");

    const pianoRect = keyEl.parentElement.getBoundingClientRect();
    const keyRect = keyEl.getBoundingClientRect();

    el.style.left = `${keyRect.left - pianoRect.left}px`;
    el.style.width = `${keyRect.width}px`;
    el.style.bottom = "0px";

    pianoRoll.appendChild(el);

    const data = {
        el,
        start: performance.now(),
        released: false,
        releaseTime: null
    };

    function animate() {
        const now = performance.now();
        const speed = 0.05;

        if (!data.released) {
            el.style.height = `${(now - data.start) * speed}px`;
        } else {
            const t = now - data.releaseTime;
            el.style.transform = `translateY(-${t * speed}px)`;

            if (t * speed > pianoRoll.clientHeight + 100) {
                el.remove();
                return;
            }
        }

        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
    return data;
}

function releaseRollNote(roll) {
    if (!roll || roll.released) return;

    roll.released = true;
    roll.releaseTime = performance.now();
}

function noteOn(keyEl, shouldRecord = true) {
    const key = keyEl.dataset.key;
    const note = keyEl.dataset.note;

    if (activeNotes.has(key)) {

    if (sustain) {
        const oldData = activeNotes.get(key);

        stopSound(oldData.audio);
        releaseRollNote(oldData.roll);

        activeNotes.delete(key);
        sustainedNotes.delete(key);
    } else {
        return;
    }
}

    const audio = playSound(note);
    let mode = "live";
    if (isRecording) mode = "record";
    if (isPlaying) mode = "playback";

    const roll = createRollNote(keyEl, mode);

    activeNotes.set(key, { audio, roll });
    keyEl.classList.add("active");

    if (isRecording && shouldRecord && !isPlaying) {

    if (recordArmed && !hasStartedRecording) {
        recordStart = performance.now();
        hasStartedRecording = true;
        recordArmed = false;

        recordBtn.textContent = "RECORD: ON";
        recordBtn.classList.add("recording");
    }

    recording.push({
    key,
    note,
    time: hasStartedRecording ? performance.now() - recordStart : 0,
    duration: null
});

    noteStartTimes[key] = performance.now();
}
}

function noteOff(keyEl, shouldRecord = true) {
    const key = keyEl.dataset.key;
    const data = activeNotes.get(key);

    if (!data) return;

    keyEl.classList.remove("active");

    if (isRecording && shouldRecord && noteStartTimes[key]) {
        const duration = performance.now() - noteStartTimes[key];

        for (let i = recording.length - 1; i >= 0; i--) {
            if (recording[i].key === key && recording[i].duration == null) {
                recording[i].duration = duration;
                break;
            }
        }

        delete noteStartTimes[key];
    }

    if (sustain) {
        sustainedNotes.add(key);
        return;
    }

    stopSound(data.audio);
    releaseRollNote(data.roll);
    activeNotes.delete(key);
}

function releaseSustainedNotes() {
    sustainedNotes.forEach(key => {
        const data = activeNotes.get(key);
        if (!data) return;

        stopSound(data.audio);
        releaseRollNote(data.roll);
        activeNotes.delete(key);

        const keyEl = document.querySelector(`.key[data-key="${key}"]`);
        if (keyEl) keyEl.classList.remove("active");
    });

    sustainedNotes.clear();
}

function stopAll() {
    playbackTimeouts.forEach(timeout => clearTimeout(timeout));
    playbackTimeouts = [];

    activeNotes.forEach((data, key) => {
        stopSound(data.audio);
        releaseRollNote(data.roll);

        const keyEl = document.querySelector(`.key[data-key="${key}"]`);
        if (keyEl) keyEl.classList.remove("active");
    });

    activeNotes.clear();
    sustainedNotes.clear();
    noteStartTimes = {};

    isPlaying = false;
    playBtn.classList.remove("playing");

    pianoRoll.classList.remove("playing");
    pianoRoll.classList.remove("recording");
}

keys.forEach(keyEl => {
    keyEl.addEventListener("pointerdown", event => {
        event.preventDefault();
        noteOn(keyEl);
    });

    keyEl.addEventListener("pointerup", () => {
        noteOff(keyEl);
    });

    keyEl.addEventListener("pointercancel", () => {
        noteOff(keyEl);
    });

    keyEl.addEventListener("pointerleave", event => {
        if (event.buttons === 1) {
            noteOff(keyEl);
        }
    });
});

document.addEventListener("keydown", event => {

    if (
    document.activeElement.tagName === "INPUT" ||
    document.activeElement.tagName === "TEXTAREA"
) {
    return;
}
    if (event.repeat) return;

    if (event.code === "Space") {
        event.preventDefault();

        sustain = !sustain;
        updateSustainIndicator();

        if (!sustain) {
            releaseSustainedNotes();
        }

        return;
    }

    const keyEl = document.querySelector(`.key[data-key="${event.key.toLowerCase()}"]`);
    if (!keyEl) return;

    noteOn(keyEl);
});

document.addEventListener("keyup", event => {
    const keyEl = document.querySelector(`.key[data-key="${event.key.toLowerCase()}"]`);
    if (!keyEl) return;

    noteOff(keyEl);
});

recordBtn.onclick = () => {
    isRecording = !isRecording;

    if (isRecording) {
        stopAll();
        recording = [];

        recordArmed = true;
        hasStartedRecording = false;

        recordBtn.textContent = "RECORD: ARMED";
        recordBtn.classList.add("recording");

        pianoRoll.classList.add("recording");
        pianoRoll.classList.remove("playing");
    } else {
        recordBtn.textContent = "RECORD: OFF";
        recordBtn.classList.remove("recording");

        recordArmed = false;
        hasStartedRecording = false;
    }
};

playBtn.onclick = () => {
    if (recording.length === 0) return;

    stopAll();
    stopRecording();

    isPlaying = true;
    playBtn.classList.add("playing");

    pianoRoll.classList.add("playing");
    pianoRoll.classList.remove("recording");

    recording.forEach(recordedNote => {
        const startTimeout = setTimeout(() => {
            const keyEl = document.querySelector(`.key[data-key="${recordedNote.key}"]`);
            if (!keyEl) return;

            noteOn(keyEl, false);

            const stopTimeout = setTimeout(() => {
                noteOff(keyEl, false);
            }, recordedNote.duration || 200);

            playbackTimeouts.push(stopTimeout);
        }, recordedNote.time);

        playbackTimeouts.push(startTimeout);
    });

    const finalTime = Math.max(...recording.map(note => note.time + (note.duration || 200)));

    const doneTimeout = setTimeout(() => {
        isPlaying = false;
        playBtn.classList.remove("playing");
        pianoRoll.classList.remove("playing");
    }, finalTime + 100);

    playbackTimeouts.push(doneTimeout);
};

stopBtn.onclick = () => {
    stopAll();
    stopRecording();
};

exportBtn.onclick = () => {

    stopRecording();
exportModal.classList.remove("hidden");
songNameInput.focus();
}

async function saveFileToFolder(text, filename) {
    if (!saveDirectoryHandle) {
        await chooseSaveFolder();
    }

    const fileHandle = await saveDirectoryHandle.getFileHandle(filename, {
        create: true
    });

    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    playSaveSound();
    showSaveNotification("Success, Young Wizard! ✔");
}

confirmExportBtn.onclick = async () => {

    let name = songNameInput.value.trim();

    if (!name) {
        name = `wizard101-song-${songCounter}`;
    }

    const sorted = [...recording].sort((a, b) => a.time - b.time);

        if (sorted.length === 0) {
            alert("Nothing recorded yet.");
            return;
        }

        const PHRASE_GAP = 800;
        const REST_GAP = 180;
        const CHORD_WINDOW = 70;

        let firstNote = true;
        let lastTime = sorted[0].time;

        const lines = [];
        let currentLine = [];

        let chord = [];
        let chordStart = null;

    function flushChord() {
        if (chord.length === 0) return;

        if (chord.length === 1) {
            currentLine.push(chord[0]);
        } else {
            currentLine.push(`[ ${chord.join(" + ")} ]`);
        }

        chord = [];
        chordStart = null;
    }

    function flushLine() {
        flushChord();

        if (currentLine.length > 0) {
            lines.push(currentLine.join(" "));
            currentLine = [];
        }
    }

    sorted.forEach(note => {

        let gap = note.time - lastTime;

        if (firstNote) {
            gap = 0;
            firstNote = false;
        }

        if (gap > PHRASE_GAP) {
            flushLine();
        }

        else if (gap > REST_GAP) {
            flushChord();
        }
        
        if (chord.length === 0) {
            chord = [note.key.toLowerCase()];
            chordStart = note.time;
        }
        else if (note.time - chordStart <= CHORD_WINDOW) {
            chord.push(note.key.toLowerCase());
        }
        else {
            flushChord();
            chord = [note.key.toLowerCase()];
            chordStart = note.time;
        }

        lastTime = note.time;
    });

    flushLine();

        const header =
    `TITLE: ${name}
===============
Made with Wizard101 Phrase Piano
Created by Victoria SwiftStone
Date: ${new Date().toLocaleString()}
===============
    `;

    const text =
        header +
        lines
            .map(line => line.trim().replace(/\s+/g, " "))
            .join("\n");

    await saveFileToFolder(text, `${name}.txt`);

    songCounter++;
    localStorage.setItem("wizard101SongCounter", songCounter);

    exportModal.classList.add("hidden");
    songNameInput.value = "";
};

siteBtn.onclick = () => {
    window.open(
        "https://www.wizard101central.com/forums/showthread.php?359190-Music-Library-For-Instruments",
        "_blank"
    );
};


labelToggleBtn.onclick = () => {

    labelMode = labelMode === "keys"
        ? "notes"
        : "keys";

    keys.forEach(keyEl => {

        const label = keyEl.querySelector(".key-label");

        if (!label) return;

        if (labelMode === "keys") {

            label.textContent =
                keyEl.dataset.key.toUpperCase();

            labelToggleBtn.textContent =
                "DISPLAYING: KEYBINDS";

        } else {

            label.textContent =
                keyEl.dataset.note;

            labelToggleBtn.textContent =
                "DISPLAYING: NOTE NAMES";
        }
    });
};

songNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        confirmExportBtn.click();
    }
    if (e.key === "Escape") {
        e.preventDefault();
        cancelExportBtn.click();
    }
});

cancelExportBtn.onclick = () => {
    exportModal.classList.add("hidden");
    songNameInput.value = "";
};

exportModal.onclick = (e) => {
    if (e.target === exportModal) {
        exportModal.classList.add("hidden");
        songNameInput.value = "";

        recordArmed = false;
        hasStartedRecording = false;
    }
};