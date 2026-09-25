/* SatisBall — colour themes. Each palette: background gradient, glow blobs, ball colours with names, ring gradient. */
'use strict';
(function (SB) {
  const P = [
    {
      id: 'neon', name: 'Neon Noir',
      bg: ['#0a0620', '#170a36', '#06030f'], glow: ['#6b21ff', '#ff2d95'],
      text: '#ffffff', accent: '#ff3d8b', dim: '#8d7fc2',
      grad: ['#ff2d75', '#ff8a3d', '#ffe03d', '#3dffb0', '#22c8ff', '#8a5bff', '#ff2d75'],
      balls: [
        { c: '#ff2d75', n: 'ROSE' }, { c: '#22e5ff', n: 'AQUA' }, { c: '#b6ff3b', n: 'LIME' }, { c: '#ffb020', n: 'AMBER' },
        { c: '#a95bff', n: 'VIOLET' }, { c: '#ff6b3d', n: 'BLAZE' }, { c: '#3d7bff', n: 'COBALT' }, { c: '#ffffff', n: 'GHOST' },
        { c: '#3dffb0', n: 'MINT' }, { c: '#ff8adf', n: 'BUBBLE' }, { c: '#ffe95c', n: 'SUNNY' }, { c: '#00ffcc', n: 'TEAL' },
      ],
    },
    {
      id: 'sunset', name: 'Sunset Pop',
      bg: ['#1c0734', '#4a0f4f', '#12031f'], glow: ['#ff6a3d', '#c21bff'],
      text: '#fff6ec', accent: '#ffd23f', dim: '#c79ac4',
      grad: ['#ffd23f', '#ff9a3d', '#ff4f6d', '#e03dff', '#7a5cff', '#3dd6ff', '#ffd23f'],
      balls: [
        { c: '#ffd23f', n: 'SUN' }, { c: '#3df2c2', n: 'MINT' }, { c: '#ff4f8b', n: 'PUNCH' }, { c: '#5ab0ff', n: 'SKY' },
        { c: '#ff8a2f', n: 'MANGO' }, { c: '#c77dff', n: 'LILAC' }, { c: '#ffffff', n: 'CLOUD' }, { c: '#9dff5c', n: 'KIWI' },
        { c: '#ff5ce1', n: 'FLAMINGO' }, { c: '#48f0ff', n: 'LAGOON' }, { c: '#ffb3c7', n: 'PEACH' }, { c: '#ffef99', n: 'BUTTER' },
      ],
    },
    {
      id: 'ocean', name: 'Deep Ocean',
      bg: ['#01101f', '#032a52', '#000814'], glow: ['#00b3ff', '#00ffc3'],
      text: '#effbff', accent: '#43f7d8', dim: '#6f9fc4',
      grad: ['#43f7d8', '#22b8ff', '#5b6bff', '#b35bff', '#ff5ba8', '#ff8f59', '#43f7d8'],
      balls: [
        { c: '#ff6f59', n: 'CORAL' }, { c: '#43f7d8', n: 'REEF' }, { c: '#ffe45e', n: 'PEARL' }, { c: '#ff47a8', n: 'URCHIN' },
        { c: '#9d7bff', n: 'SQUID' }, { c: '#5ce1ff', n: 'WAVE' }, { c: '#b5ff6b', n: 'KELP' }, { c: '#ffffff', n: 'FOAM' },
        { c: '#ff9f43', n: 'CLOWN' }, { c: '#00ffa3', n: 'JADE' }, { c: '#ffa3d7', n: 'SHELL' }, { c: '#7fb2ff', n: 'TIDE' },
      ],
    },
    {
      id: 'aurora', name: 'Aurora',
      bg: ['#020f10', '#0a2a38', '#020608'], glow: ['#00ff9d', '#8f5bff'],
      text: '#f2fff9', accent: '#3dffa2', dim: '#7fb8a8',
      grad: ['#3dffa2', '#2ee6ff', '#6d7bff', '#c25bff', '#ff5fd2', '#fff36b', '#3dffa2'],
      balls: [
        { c: '#3dffa2', n: 'NORTH' }, { c: '#b388ff', n: 'COSMO' }, { c: '#ff5fd2', n: 'NOVA' }, { c: '#56d6ff', n: 'FROST' },
        { c: '#fff36b', n: 'STAR' }, { c: '#ff7a59', n: 'EMBER' }, { c: '#ffffff', n: 'COMET' }, { c: '#7dff4a', n: 'SPROUT' },
        { c: '#ff4a7d', n: 'MARS' }, { c: '#4affea', n: 'ICE' }, { c: '#d9a3ff', n: 'LUNA' }, { c: '#ffb84a', n: 'SOLAR' },
      ],
    },
    {
      id: 'vapor', name: 'Vaporwave',
      bg: ['#14002e', '#3b0764', '#0b0019'], glow: ['#ff71ce', '#01cdfe'],
      text: '#fff8ff', accent: '#ff71ce', dim: '#b58bd6',
      grad: ['#ff71ce', '#b967ff', '#01cdfe', '#05ffa1', '#fffb96', '#ff71ce'],
      balls: [
        { c: '#ff71ce', n: 'MIAMI' }, { c: '#01cdfe', n: 'CYBER' }, { c: '#05ffa1', n: 'MATRIX' }, { c: '#fffb96', n: 'LEMON' },
        { c: '#b967ff', n: 'GRAPE' }, { c: '#ff9a5a', n: 'RETRO' }, { c: '#ffffff', n: 'CHROME' }, { c: '#ff3860', n: 'LASER' },
        { c: '#5affff', n: 'GLITCH' }, { c: '#d6ff5a', n: 'ACID' }, { c: '#ffb7f0', n: 'TAFFY' }, { c: '#7a8bff', n: 'DREAM' },
      ],
    },
    {
      id: 'lava', name: 'Molten',
      bg: ['#120303', '#3a0a08', '#070101'], glow: ['#ff3d00', '#ffb300'],
      text: '#fff4e6', accent: '#ffb000', dim: '#b98272',
      grad: ['#fff1a8', '#ffcc33', '#ff8c1a', '#ff4a1a', '#ff1f5a', '#ff66b3', '#fff1a8'],
      balls: [
        { c: '#ffcc33', n: 'GOLD' }, { c: '#33e0ff', n: 'COOLANT' }, { c: '#ff4a1a', n: 'MAGMA' }, { c: '#ffffff', n: 'SPARK' },
        { c: '#ff1f7a', n: 'RUBY' }, { c: '#9dff3d', n: 'TOXIC' }, { c: '#ff8c1a', n: 'FLARE' }, { c: '#b07cff', n: 'AMETHYST' },
        { c: '#ffe699', n: 'BRASS' }, { c: '#3dffc5', n: 'JADE' }, { c: '#ff6b6b', n: 'CINDER' }, { c: '#6bb8ff', n: 'STEEL' },
      ],
    },
    {
      id: 'mono', name: 'Midnight Gold',
      bg: ['#08080c', '#17151f', '#030305'], glow: ['#ffcf66', '#6f7bff'],
      text: '#fffaf0', accent: '#ffd166', dim: '#8f8a9e',
      grad: ['#ffd166', '#fff1c9', '#ffffff', '#c9d6ff', '#8fa5ff', '#ffd166'],
      balls: [
        { c: '#ffd166', n: 'GOLD' }, { c: '#f4f4f4', n: 'PEARL' }, { c: '#ff5e5b', n: 'RUBY' }, { c: '#7bdff2', n: 'SAPPHIRE' },
        { c: '#b8f2a0', n: 'JADE' }, { c: '#d7a6ff', n: 'OPAL' }, { c: '#ff9f68', n: 'COPPER' }, { c: '#9aa7ff', n: 'IRIS' },
        { c: '#ffe8a3', n: 'CHAMPAGNE' }, { c: '#ff8fb1', n: 'QUARTZ' }, { c: '#6ff7c5', n: 'EMERALD' }, { c: '#c0c8d8', n: 'SILVER' },
      ],
    },
    {
      id: 'candy', name: 'Candy Paper', light: true,
      bg: ['#fff4ea', '#ffe2ec', '#f3e9ff'], glow: ['#ffb3d1', '#b3d4ff'],
      text: '#1b1030', accent: '#ff2e7e', dim: '#9a86a8',
      grad: ['#ff2e7e', '#ff8a00', '#ffc400', '#00c49a', '#1f8bff', '#8a3dff', '#ff2e7e'],
      balls: [
        { c: '#ff2e7e', n: 'BERRY' }, { c: '#1f8bff', n: 'BLUEY' }, { c: '#00b88f', n: 'MINTY' }, { c: '#ff8a00', n: 'ORANGE' },
        { c: '#8a3dff', n: 'GRAPE' }, { c: '#ffc400', n: 'LEMON' }, { c: '#1b1030', n: 'LICORICE' }, { c: '#ff4d4d', n: 'CHERRY' },
        { c: '#00b3d6', n: 'SODA' }, { c: '#e05cff', n: 'MAGIC' }, { c: '#6bbf00', n: 'APPLE' }, { c: '#ff7ab8', n: 'TAFFY' },
      ],
    },
  ];
  const byId = Object.fromEntries(P.map((p) => [p.id, p]));
  SB.palettes = { list: P, get: (id) => byId[id] || P[0] };
})(window.SB);
