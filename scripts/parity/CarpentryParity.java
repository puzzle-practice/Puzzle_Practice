// Writes src/puzzles/vampire-carp/carpentry-parity.json by playing random vampire carpentry games on
// the real game's CarpentryBoard, Hole and piece (carpentry/q) classes, driven the way the game's
// CarpentryController drives them: the neglect count and the next toolbox piece come first, then the
// piece is nailed in, then a finished hole may bring new ones. board.test.ts replays the same moves
// on the TypeScript port and checks the toolbox and every hole after each one.
//
// Build 20260909165753. From D:\Documents\PP_Clone (Git Bash):
//   "$JB/javac.exe" -cp $CP -d /tmp/cp work/pp-carpentry/scripts/parity/CarpentryParity.java
//   "$JB/java.exe" -cp "$CP;/tmp/cp" CarpentryParity > work/pp-carpentry/src/puzzles/vampire-carp/carpentry-parity.json
import com.threerings.piracy.puzzle.duty.carpentry.CarpentryBoard;
import com.threerings.piracy.puzzle.duty.carpentry.Hole;
import com.threerings.piracy.puzzle.duty.carpentry.q;
import java.awt.Point;
import java.util.*;

public class CarpentryParity {
  static final int LEVEL = 17;

  public static void main(String[] args) {
    StringBuilder out = new StringBuilder("[\n");
    for (int game = 0; game < 6; game++) {
      long seed = 1000003L * game + 17;
      Random pick = new Random(seed * 31 + 7);
      CarpentryBoard board = new CarpentryBoard(8);
      board.setholeSizeOverride(5);
      board.initializeSeed(seed);
      if (game > 0) out.append(",\n");
      out.append("{\"seed\":").append(seed).append(",\"start\":").append(state(board, 0, 0)).append(",\"moves\":[");
      int done = 0;
      boolean first = true;
      for (int move = 0; move < 160 && done < LEVEL; move++) {
        int slot = -1, hole = -1, orient = 0;
        Point at = null;
        for (int tries = 0; tries < 50 && at == null; tries++) {
          slot = pick.nextInt(3);
          orient = pick.nextInt(8);
          hole = pick.nextInt(4);
          Hole h = board.getHole(hole);
          if (h.getSize() == 0 || h.isFilled()) continue;
          q piece = new q(board.getTool(slot), null, (byte) orient);
          List<Point> spots = new ArrayList<>();
          for (int x = -2; x < h.getWidth() + 2; x++)
            for (int y = -2; y < h.getHeight() + 2; y++)
              if (h.checkPiece(piece, x, y) != 0) spots.add(new Point(x, y));
          if (!spots.isEmpty()) at = spots.get(pick.nextInt(spots.size()));
        }
        if (at == null) break;
        q piece = new q(board.getTool(slot), null, (byte) orient);
        int reopened = board.pieceWillApply(hole);
        board.populateNextTool(slot);
        Hole h = board.getHole(hole);
        int covered = h.placePiece(piece, at);
        int dx = 0, dy = 0;
        int rank = -1;
        if (h.isFilled()) {
          rank = h.getHoleRank();
          done++;
          Point p = board.checkForNewHoles(LEVEL - done);
          dx = p.x;
          dy = p.y;
        }
        if (!first) out.append(",");
        first = false;
        out.append("{\"slot\":").append(slot).append(",\"orient\":").append(orient).append(",\"hole\":").append(hole)
            .append(",\"at\":[").append(at.x).append(",").append(at.y).append("],\"reopened\":").append(reopened)
            .append(",\"covered\":").append(covered).append(",\"rank\":").append(rank)
            .append(",\"after\":").append(state(board, dx, dy)).append("}");
      }
      out.append("]}");
    }
    out.append("\n]\n");
    System.out.print(out);
  }

  static String state(CarpentryBoard board, int dx, int dy) {
    StringBuilder s = new StringBuilder("{\"tools\":[");
    for (int i = 0; i < 3; i++) s.append(i > 0 ? "," : "").append(board.getTool(i));
    s.append("],\"scroll\":[").append(dx).append(",").append(dy).append("],\"holes\":[");
    for (int i = 0; i < 4; i++) {
      Hole h = board.getHole(i);
      Point k = h.getKnockPick();
      s.append(i > 0 ? "," : "").append("{\"id\":").append(h.getHoleId()).append(",\"size\":").append(h.getSize())
          .append(",\"used\":").append(h.getPiecesUsed()).append(",\"grain\":").append(h.isGrainPreserved())
          .append(",\"knock\":").append(k == null ? "null" : "[" + k.x + "," + k.y + "]")
          .append(",\"dump\":\"").append(h.dumpHole().replace("\n", "|")).append("\"}");
    }
    return s.append("]}").toString();
  }
}
