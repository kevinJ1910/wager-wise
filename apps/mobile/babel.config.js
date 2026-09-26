module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 movió su plugin de Babel a react-native-worklets.
    // Debe ir siempre el último de la lista.
    plugins: ['react-native-worklets/plugin'],
  };
};
