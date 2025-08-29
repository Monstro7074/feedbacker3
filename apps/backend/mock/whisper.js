// mock/whisper.js
console.log('🔑 OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'OK' : 'MISSING');

export const mockWhisper = (audioUrl) => {
  return {
    transcript: 'Блузка красивая, но в плечах тянет, ткань неприятная на ощупь.'
  };
};