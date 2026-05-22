function inlineKeyboard(buttons) {
  return [
    {
      type: 'inline_keyboard',
      payload: {
        buttons
      }
    }
  ];
}

module.exports = { inlineKeyboard };
