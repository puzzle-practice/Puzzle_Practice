import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Rumble',
  description: 'Rumbling: shoot balls from two fists, pop three of a colour, charge sparks for chains and punch your opponents. Build boards in Freeplay, or practise precision and bounce shots in Aim trainer, graded Easy to Very hard, with 3 lives and a two-minute countdown.',
  help: 'Move the mouse over the board to aim both fists, or use the arrow keys (hold Shift for fine aim). The left button (or Z) fires the left fist and the right button (or X) the right; hold one for a second to charge the ball in Fight or Freeplay. Aim trainer: pick a difficulty (or Mixed), then shoot the active coloured ball into target 1; target 2 and the next ball preview the following shot. Easy targets go straight in; Medium give a fair spread of angles or bounce near the target; Hard need a tighter angle and a longer bank; Very hard need two bounces, a window of a degree or less, or a bounce far from the target. Grey hands are disabled. Each connection scores 1, each miss costs a life, and the round ends after 3 misses or 2 minutes. With several pirates, A and S (or [ and ]) change who you attack, or click a status: click a teammate to defend them. In Freeplay mode, hold 1-5 to paint red, yellow, orange (a furball in werewolf rumbling), cyan or blue under the mouse and 0 to erase, or pick a colour in the panel and click or drag; the wheel changes a ball\'s colour, C charges it, B bruises it, P lands the punch, R rolls a new one, G deals a new board, U undoes and V previews the punch on the board. Keys can be changed on the Settings tab.',
  width: 450,
  height: 600,
  order: 10,
  thumbnail,
} satisfies PuzzleMeta;
