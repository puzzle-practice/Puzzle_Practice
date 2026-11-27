// What the player should do in each lesson ("About this strategy"), with Jice's tips. Keyed by topic
// id and lesson mode. Lessons without notes show their topic's general text, marked [TODO:AI] as still to write.

export interface LessonNotes { about: string[]; tips: string[] }

export const LESSON_NOTES: Record<string, LessonNotes> = {
  'cascade-single:learn': {
    about: [
      'This is the simplest way to play navigation during Dens. We are going to make reverse doubles, such that pieces cascade after the targets are cleared on a single. We do this because, for the purpose of spawning wild pieces, this clear counts as a double (although for scoring it only counts as a single). This allows us to make the next clear much quicker.',
    ],
    tips: [
      'On the very first board, it is often a good idea to make more than one pair, because then you have the pair already set up for the next clear.',
      'Two pieces in a row tends to be better than two pieces with another in between, because there are generally more locations to put this to create a cascade.',
    ],
  },
  'cascade-single:cascade-open': {
    about: ['Build ring 1 such that a piece will cascade when the constellation is cleared.'],
    tips: ['I would start by taking a look at all the targets and then choose a colour for the cascade that is not needed for the rest of the board.'],
  },
  'cascade-single:cascade-setup': {
    about: ['A constellation has just been cleared. Set up the cascade; you may need to clear out a couple of pieces to achieve this.'],
    tips: ['I first look at ring 2: does it already match in a certain orientation? Then I look at ring 1: does it have any pairs already? Can I line these rings up without clearing anything? If not, which piece should I prioritise clearing?'],
  },
  'cascade-single:cascade-practice': {
    about: ['Now do the same as in lesson 3, and then finish matching ring 3 to complete the clear!'],
    tips: [],
  },
  'vertical-triple:learn': {
    about: ['This strategy requires two pieces of the same colour in ring 1. We will drop a third piece to match them using a vertical through rings 1, 2 and 3. This vertical must not pass through any targets, and at least one of the targets surrounding it must be filled incorrectly. If the stars that clear in ring 1 pass underneath the ring 3 target, a piece of the same colour must be placed in ring 4 above it.'],
    tips: ['Think carefully about what colours you use for the combo. If the board has no orange or yellow targets, then you should use yellow and orange for the combo.'],
  },
  'vertical-triple:plan': {
    about: ['Plan the triple using the keys B, R, O, W, Y to paint the pieces onto the board. You should aim to turn as many targets as possible wild without passing under the ring 3 target unless necessary.'],
    tips: ['Remember, there are two ways to make a triple: the pieces side by side with the vertical on one end, and the vertical between matching pieces.'],
  },
  'vertical-triple:build': {
    about: ['The same as lesson 2, but now by playing the puzzle. Try to ensure that you do not place pieces below a target they match, unless that target will turn wild.'],
    tips: [],
  },
  'vertical-triple:finish': {
    about: ['Ring 1 has been completed for you. You must now finish the combo!'],
    tips: ['It was suggested by the player Mincemeat that we offset ring 1, instead of 2 or 3, when building the combo. This makes it much easier to check that pieces in rings 1 and 2 don’t match, and neither do pieces in rings 2 and 3.'],
  },
  'vertical-triple:practise': {
    about: ['Test your speed and consistency by building the combo over and over.'],
    tips: [],
  },
  'donkey:learn': {
    about: ['The easiest way to build a donkey is from a fresh board. You start pairing up the pieces, with the two remaining colours side by side. Notice how some of the columns drop down once, some twice and one not at all. It is important that the ring 3 target is in one of the columns that only drops down once.'],
    tips: ['I first check for an open column two columns away from the ring 3 target in either direction. If this is open, the order of the pairs in ring 1 doesn’t matter at all, and we combo in the rotation away from the ring 3 target. If this is not possible, my next plan is to do the same thing but 3 columns away from the ring 3 target, then go away from the ring 3 target again. The reason I like these is that we will always drop into ring 3 at the end; this ensures that accidentally matching targets around the end of the combo will not clear it prematurely.'],
  },
  'donkey:donkeyring': {
    about: ['Pair up the pieces in ring 1 as quickly as possible!'],
    tips: ['I like to create an X with the first 4 colours, with 2 pieces of different colours opposite each other. This gives you freedom to pair up any colour to start with. It also creates platforms ready to manoeuvre pieces around ring 2.'],
  },
  'donkey:donkeybase': {
    about: ['Find an appropriate column, such that the column containing the ring 3 target will only drop once and the board does not end early!'],
    tips: [],
  },
  'donkey:donkeylayer': {
    about: ['Now build layer 2. Ensure that the correct pieces will drop down and nothing else will line up between rings 1 and 2. Ideally this is true both when the ring is in the correct position, and when it is offset.'],
    tips: ['I like to offset away from the direction of the clear; this ensures that the pieces that drop in do not line up with the pieces they will later clear with. Remember you will spawn two of each colour, so make sure you don’t have blues coming and only space above the blues!'],
  },
  'donkey:donkey': {
    about: ['Now practise the full combo. Turn the practice stats on in the settings if you wish to measure your consistency or speed.'],
    tips: [],
  },
};

export const notesFor = (lesson: string, mode: string): LessonNotes | undefined => LESSON_NOTES[`${lesson}:${mode}`];
