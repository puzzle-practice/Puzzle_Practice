// Writes src/puzzles/vampire-carp/carpentry-token-parity.json by playing random normal carpentry
// games, with and without maneuver tokens, on the real game's CarpentryBoard, Hole and piece
// (carpentry/d) classes. The moves follow the game's CarpentryController: neglect and the next
// toolbox piece first, then the piece is nailed in, then a finished hole is scored (its points, the
// masterpiece streak and the token it shows) and may bring new holes. board.test.ts replays the
// same moves on the TypeScript port.
//
// Test build 20261017062155. With the build's jar as $JAR:
//   javac -cp $JAR -d /tmp/cp scripts/parity/CarpentryTokenParity.java
//   java -cp "$JAR:/tmp/cp" CarpentryTokenParity > src/puzzles/vampire-carp/carpentry-token-parity.json
import com.threerings.piracy.puzzle.duty.carpentry.CarpentryBoard;
import com.threerings.piracy.puzzle.duty.carpentry.Hole;
import com.threerings.piracy.puzzle.duty.carpentry.d;
import java.awt.Point;
import java.lang.reflect.Field;
import java.util.*;

public class CarpentryTokenParity {
  static final int[] LEVEL = {1, 1, 4, 6, 8, 10, 12, 15, 17, 20};

  public static void main(String[] args) throws Exception {
    StringBuilder out = new StringBuilder("[\n");
    for (int game = 0; game < 9; game++) {
      if (game > 0) out.append(",\n");
      out.append(play(7919L * game + 101, game, new int[1]));
    }
    // Then token games where finished holes show tokens, searched for in seed order.
    int found = 0;
    for (long seed = 500; found < 3; seed++) {
      int[] tokens = new int[1];
      String g = play(seed, 9 + found, tokens);
      if (tokens[0] < 2) continue;
      out.append(",\n").append(g);
      found++;
    }
    out.append("\n]\n");
    System.out.print(out);
  }

  static String play(long seed, int game, int[] tokens) throws Exception {
    StringBuilder out = new StringBuilder();
    Random pick = new Random(seed * 13 + 5);
    int difficulty = game < 2 ? game : 2 + pick.nextInt(8);
    byte mode = (byte) (game >= 9 ? 1 + game % 2 : game % 3);
    byte desired = (byte) (game % 4 == 3 ? 1 + pick.nextInt(4) : -1);
    CarpentryBoard board = new CarpentryBoard(difficulty);
    board.setBonusMode(mode);
    board.setDesiredBonus(desired);
    board.initializeSeed(seed);
    out.append("{\"seed\":").append(seed).append(",\"difficulty\":").append(difficulty).append(",\"mode\":").append(mode)
        .append(",\"desired\":").append(desired).append(",\"start\":").append(state(board, 0, 0)).append(",\"moves\":[");
    int done = 0;
    boolean first = true;
    int level = LEVEL[difficulty];
    for (int move = 0; move < 120 && done < level; move++) {
      int slot = -1, hole = -1, orient = 0;
      Point at = null;
      for (int tries = 0; tries < 50 && at == null; tries++) {
        slot = pick.nextInt(3);
        orient = difficulty < 2 ? 1 : pick.nextInt(8);
        hole = pick.nextInt(4);
        Hole h = board.getHole(hole);
        if (h.getSize() == 0 || h.isFilled()) continue;
        d piece = new d(board.getTool(slot), board.getBonus(slot), (byte) orient);
        List<Point> spots = new ArrayList<>();
        for (int x = -2; x < h.getWidth() + 2; x++)
          for (int y = -2; y < h.getHeight() + 2; y++)
            if (inView(h, piece, x, y) && h.checkPiece(piece, x, y) != 0) spots.add(new Point(x, y));
        if (spots.isEmpty()) continue;
        // Mostly a spot that covers the most open cells, so holes finish well and tokens line up.
        if (pick.nextInt(5) > 0) {
          int most = 0;
          for (Point p : spots) most = Math.max(most, h.checkPiece(piece, p.x, p.y));
          final int best = most;
          final d pc = piece;
          spots.removeIf(p -> h.checkPiece(pc, p.x, p.y) < best);
        }
        at = spots.get(pick.nextInt(spots.size()));
      }
      if (at == null) break;
      d piece = new d(board.getTool(slot), board.getBonus(slot), (byte) orient);
      int reopened = board.pieceWillApply(hole);
      board.populateNextTool(slot);
      Hole h = board.getHole(hole);
      int covered = h.placePiece(piece, at);
      int dx = 0, dy = 0, rank = -1, points = 0, streak = 0, token = 0;
      Point tokenAt = new Point(-1, -1);
      if (h.isFilled()) {
        rank = h.getHoleRank();
        points = h.computeBonus();
        streak = board.checkPerfectBonus(hole);
        token = h.getBonus(tokenAt, board.getDesiredBonus(), board.getRandom());
        if (token != 0) tokens[0]++;
        done++;
        Point p = board.checkForNewHoles(level - done);
        dx = p.x;
        dy = p.y;
      }
      if (!first) out.append(",");
      first = false;
      out.append("{\"slot\":").append(slot).append(",\"orient\":").append(orient).append(",\"hole\":").append(hole)
          .append(",\"at\":[").append(at.x).append(",").append(at.y).append("],\"reopened\":").append(reopened)
          .append(",\"covered\":").append(covered).append(",\"rank\":").append(rank).append(",\"points\":").append(points)
          .append(",\"streak\":").append(streak).append(",\"token\":").append(token)
          .append(",\"tokenAt\":[").append(token == 0 ? -1 : tokenAt.x).append(",").append(token == 0 ? -1 : tokenAt.y).append("]")
          .append(",\"after\":").append(state(board, dx, dy)).append("}");
    }
    return out.append("]}").toString();
  }

  /** The board view only offers spots where every cell of a plank is within a cell of the hole's 10x10 box. */
  static boolean inView(Hole h, d piece, int x, int y) {
    if (piece.f()) return true;
    for (int k = 0; k < 5; k++) {
      Point c = piece.n(k);
      int bx = c.x + x + (10 - h.getWidth()) / 2;
      int by = c.y + y + (10 - h.getHeight()) / 2;
      if (bx < -1 || by < -1 || bx > 10 || by > 10) return false;
    }
    return true;
  }

  static String bytes(byte[] b) {
    if (b == null) return "null";
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < b.length; i++) s.append(i > 0 ? "," : "").append(b[i]);
    return s.append("]").toString();
  }

  static String bonuses(Hole h) throws Exception {
    Field f = Hole.class.getDeclaredField("_bonuses");
    f.setAccessible(true);
    byte[][] b = (byte[][]) f.get(h);
    if (b == null) return "null";
    // Only the cells holding a token quarter, as [x, y, value].
    StringBuilder s = new StringBuilder("[");
    boolean first = true;
    for (int x = 0; x < b.length; x++)
      for (int y = 0; y < b[x].length; y++)
        if (b[x][y] != 0) {
          s.append(first ? "" : ",").append("[").append(x).append(",").append(y).append(",").append(b[x][y]).append("]");
          first = false;
        }
    return s.append("]").toString();
  }

  static String state(CarpentryBoard board, int dx, int dy) throws Exception {
    StringBuilder s = new StringBuilder("{\"tools\":[");
    for (int i = 0; i < 3; i++) s.append(i > 0 ? "," : "").append(board.getTool(i));
    s.append("],\"bonuses\":[");
    for (int i = 0; i < 3; i++) s.append(i > 0 ? "," : "").append(bytes(board.getBonus(i)));
    s.append("],\"scroll\":[").append(dx).append(",").append(dy).append("],\"holes\":[");
    for (int i = 0; i < 4; i++) {
      Hole h = board.getHole(i);
      Point k = h.getKnockPick();
      s.append(i > 0 ? "," : "").append("{\"id\":").append(h.getHoleId()).append(",\"size\":").append(h.getSize())
          .append(",\"used\":").append(h.getPiecesUsed()).append(",\"grain\":").append(h.isGrainPreserved())
          .append(",\"same\":").append(h.isHomogenous())
          .append(",\"knock\":").append(k == null ? "null" : "[" + k.x + "," + k.y + "]")
          .append(",\"dump\":\"").append(h.dumpHole().replace("\n", "|")).append("\"")
          .append(",\"tokens\":").append(bonuses(h)).append("}");
    }
    return s.append("]}").toString();
  }
}
