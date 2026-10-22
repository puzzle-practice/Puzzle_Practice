import com.threerings.piracy.puzzle.duty.patching.data.*;
import com.threerings.piracy.puzzle.data.*;
import java.util.*;

/** Emit repeatable Patching boards and actions for rule verification. */
public class PatchingParity {
  static String snapshot(PatchingBoard b) {
    StringJoiner out = new StringJoiner(",", "[", "]");
    for (int i = 0; i < 42; i++) {
      PatchingPiece p = b.getPieceAt(i % 7, i / 7);
      out.add("[" + p.getType().ordinal() + "," + p.getOrientation().ordinal() + "," + p.getTension().ordinal() + "," + b.getTileAt(new BoardLoc(i % 7, i / 7)).getTension().ordinal() + "]");
    }
    return out.toString();
  }
  static class Sample extends PatchingBoard {
    String solution;
    Sample(int d) { super(d); }
    protected void shuffle(int retry) { if (retry == 0) solution = snapshot(this); super.shuffle(retry); }
    void scenario(int kind) {
      _pieces = new LinkedHashMap<>(); _tiles = new LinkedHashMap<>(); _tieOffs = new LinkedHashMap<>();
      for (int i = 0; i < 42; i++) {
        BoardLoc loc = new BoardLoc(i % 7, i / 7);
        _pieces.put(loc, new PatchingPiece(PieceType.e, loc, Orientation.m));
        _tiles.put(loc, new PatchingPiece(PieceType.m, loc, Orientation.m));
      }
      BoardLoc s = new BoardLoc(1, 1), mid = new BoardLoc(2, 1), end = new BoardLoc(3, 1), tie = new BoardLoc(4, 1);
      _spool = new SpoolPiece(s, Orientation.w); _pieces.put(s, _spool);
      _pieces.put(mid, new PatchingPiece(kind == 2 ? PieceType.w : PieceType.f, mid, Orientation.f));
      _pieces.put(end, new PatchingPiece(kind == 0 ? PieceType.s : PieceType.d, end, Orientation.f));
      BoardLoc t = kind == 0 ? end : tie;
      PatchingPiece p = new PatchingPiece(PieceType.s, t, Orientation.f); _pieces.put(t,p); _tieOffs.put(t,p);
      if (kind != 0) _pieces.put(end, new PatchingPiece(PieceType.d, end, Orientation.f));
      updateConnected();
    }
  }
  public static void main(String[] args) {
    if (args.length > 0 && args[0].equals("bonus")) {
      StringJoiner output = new StringJoiner(",", "[", "]");
      for (int d = 0; d <= 10; d++) for (byte mode = 1; mode <= 2; mode++) {
        Sample b = new Sample(d); b.setBonusMode(mode); b.initializeSeed(42);
        StringJoiner bonus = new StringJoiner(",", "[", "]");
        for (Map.Entry<BoardLoc,Integer> e : b.getBonusLocs().entrySet()) bonus.add("[" + (e.getKey().y * 7 + e.getKey().x) + "," + e.getValue() + "]");
        output.add("{\"difficulty\":" + d + ",\"mode\":" + mode + ",\"initial\":" + snapshot(b) + ",\"bonuses\":" + bonus + "}");
      }
      System.out.println(output); return;
    }
    StringJoiner all = new StringJoiner(",", "[", "]");
    for (int d = 0; d <= 10; d++) for (long seed : new long[]{0, 1, 42, 123456789, 4294967295L}) {
      Sample b = new Sample(d); b.initializeSeed(seed);
      StringBuilder s = new StringBuilder("{\"difficulty\":" + d + ",\"seed\":" + seed + ",\"initial\":" + snapshot(b) + ",\"solution\":" + b.solution + ",\"steps\":[");
      Random r = new Random(seed + 999);
      for (int step = 0; step < 24; step++) {
        int i = r.nextInt(42), j = r.nextInt(42), turn = r.nextBoolean() ? 1 : -1;
        if (b.getPieceAt(i % 7, i / 7).isMoveable()) b.rotatePiece(new BoardLoc(i % 7, i / 7), turn == 1 ? Rotation.m : Rotation.f);
        if (b.getPieceAt(i % 7, i / 7).isMoveable() && b.getPieceAt(j % 7, j / 7).isMoveable() && i != j) b.movePiece(new BoardLoc(i % 7, i / 7), new BoardLoc(j % 7, j / 7));
        if (step > 0) s.append(',');
        s.append("{\"i\":" + i + ",\"j\":" + j + ",\"turn\":" + turn + ",\"board\":" + snapshot(b) + "}");
      }
      boolean done = b.gust();
      s.append("],\"gust\":{\"done\":" + done + ",\"score\":" + b.calculateScore() + ",\"torn\":" + b.getNumTornInLastGust() + ",\"board\":" + snapshot(b) + "}}");
      all.add(s.toString());
    }
    System.out.println(all);
    StringJoiner cases = new StringJoiner(",", "[", "]");
    for (int kind = 0; kind < 3; kind++) {
      Sample b = new Sample(5); b.initializeSeed(42); b.scenario(kind);
      String initial = snapshot(b); boolean done = b.gust();
      String first = snapshot(b); int score = b.calculateScore(), torn = b.getNumTornInLastGust();
      StringJoiner used = new StringJoiner(",", "[", "]"); for (BoardLoc loc : b.getUsedGrommetLocs()) used.add(String.valueOf(loc.y * 7 + loc.x));
      b.updateConnected(); boolean secondDone = b.gust();
      cases.add("{\"kind\":" + kind + ",\"initial\":" + initial + ",\"done\":" + done + ",\"score\":" + score + ",\"torn\":" + torn + ",\"used\":" + used + ",\"first\":" + first + ",\"secondDone\":" + secondDone + ",\"second\":" + snapshot(b) + "}");
    }
    System.err.println(cases);
  }
}
