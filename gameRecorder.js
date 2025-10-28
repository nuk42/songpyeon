let recording = [];
let isRecording = false;
let startTime = 0;

const gameRecorder = {
  start: () => {
    recording = [];
    isRecording = true;
    startTime = Date.now();
  },

  stop: () => {
    isRecording = false;
  },

  add: (type, value, source = null) => {
    if (isRecording) {
      const time = Date.now() - startTime;
      let eventString = `${type},${value}`;
      if (source) {
        eventString += `,${source},${time}`;
      }
      recording.push(eventString);
    }
  },

  getRecording: () => {
    return recording.join('\n');
  },

  isRecording: () => {
    return isRecording;
  },
};

export default gameRecorder;
