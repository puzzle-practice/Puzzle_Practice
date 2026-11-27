// What the player should do in each lesson ("About this strategy"), with Jice's tips. Keyed by topic
// id and lesson mode. Lessons without notes show their topic's general text instead.

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
};

export const notesFor = (lesson: string, mode: string): LessonNotes | undefined => LESSON_NOTES[`${lesson}:${mode}`];
