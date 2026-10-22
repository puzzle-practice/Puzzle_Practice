// Test build 20261017062155. Plays its Werewolf board and moon helpers directly.
// Compile against the code jar in Test Puzzle Pirates/app/code; run this class with that
// jar and the generated class directory on the classpath. Stdout is werewolf-parity.json.
import com.threerings.piracy.puzzle.duty.forage.data.ForageBoard;
import com.threerings.puzzle.drop.data.DropBoard;
import com.threerings.piracy.puzzle.duty.forage.data.WerewolfForageBoard;
import com.threerings.piracy.puzzle.duty.forage.data.p;
import com.threerings.piracy.puzzle.duty.forage.data.k;
import com.threerings.piracy.puzzle.duty.forage.data.s;
import java.lang.reflect.*;
import java.util.*;

public class WerewolfForageParity {
  static final int W = 7, H = 10;
  static Object dropper, slider, matcher, points;
  static Method drop, spawn, resetSpawner, slide, findRuns, crate, endStep, matchStep, resetPoints, isCrate, isAnchor, isTool;
  static Field total, combo, crates, area;

  static void init() throws Exception {
    ClassLoader cl = WerewolfForageParity.class.getClassLoader();
    Class<?> edges = Class.forName("com.threerings.piracy.puzzle.duty.forage.n.f");
    Class<?> edgesIface = Class.forName("com.threerings.puzzle.drop.z.p");
    Class<?> listener = Class.forName("com.threerings.puzzle.drop.z.s");
    Class<?> spawner = Class.forName("com.threerings.piracy.puzzle.duty.forage.n.g");
    Class<?> sideways = Class.forName("com.threerings.piracy.puzzle.duty.forage.n.z");
    Class<?> runs = Class.forName("com.threerings.puzzle.drop.z.z");
    Class<?> rule = Class.forName("com.threerings.piracy.puzzle.duty.forage.n.n");
    Class<?> ruleIface = Class.forName("com.threerings.puzzle.drop.z.f");
    Class<?> scorer = Class.forName("com.threerings.piracy.puzzle.duty.forage.n.s");
    Class<?> op = Class.forName("com.threerings.puzzle.drop.data.z");
    Class<?> pieces = Class.forName("com.threerings.piracy.puzzle.duty.forage.n.k");
    Object e = edges.getConstructor().newInstance();
    dropper = spawner.getConstructor(edgesIface).newInstance(e);
    slider = sideways.getConstructor(edgesIface).newInstance(e);
    matcher = runs.getConstructor(ruleIface).newInstance(rule.getConstructor().newInstance());
    points = scorer.getConstructor().newInstance();
    drop = spawner.getMethod("z", DropBoard.class, listener);
    spawn = spawner.getMethod("n", DropBoard.class, listener);
    resetSpawner = spawner.getMethod("n");
    slide = sideways.getMethod("n", ForageBoard.class, listener, boolean.class);
    findRuns = runs.getMethod("n", DropBoard.class, op);
    crate = scorer.getMethod("n", int.class, int.class);
    endStep = scorer.getMethod("n");
    matchStep = scorer.getMethod("n", ForageBoard.class, List.class);
    resetPoints = scorer.getMethod("z");
    total = scorer.getField("f");
    isCrate = pieces.getMethod("z", int.class);
    isAnchor = pieces.getMethod("f", int.class);
    isTool = pieces.getMethod("t", int.class);
    combo = ForageBoard.class.getDeclaredField("_comboCount");
    combo.setAccessible(true);
  }

  static boolean crateAt(int p) throws Exception { return (Boolean) isCrate.invoke(null, p); }
  static boolean tool(int p) throws Exception { return (Boolean) isTool.invoke(null, p); }
  static int at(ForageBoard b, int x, int y) { return b.inBounds(x, y) ? b.getPiece(x, y) : -1; }

  static int[] cells(ForageBoard b) {
    int[] c = new int[W * H];
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) c[y * W + x] = b.getPiece(x, y);
    return c;
  }

  // The 2x2 turn.
  static void turn(ForageBoard b, int x, int y, boolean ccw) {
    int bl = b.possiblyRotateAnts(x, y + 1, ccw), tl = b.possiblyRotateAnts(x, y, ccw);
    int tr = b.possiblyRotateAnts(x + 1, y, ccw), br = b.possiblyRotateAnts(x + 1, y + 1, ccw);
    if (ccw) { b.setPiece(x, y + 1, tl); b.setPiece(x, y, tr); b.setPiece(x + 1, y, br); b.setPiece(x + 1, y + 1, bl); }
    else { b.setPiece(x, y + 1, br); b.setPiece(x, y, bl); b.setPiece(x + 1, y, tl); b.setPiece(x + 1, y + 1, tr); }
  }

  int collected;

  // Crates on the bottom row.
  boolean collect(ForageBoard b) throws Exception {
    boolean any = false;
    for (int x = 0; x < W; x++) {
      int p = b.getPiece(x, H - 1);
      if ((Boolean) isAnchor.invoke(null, p)) {
        any = true;
        int size = (p & 15728640) >> 20;
        int w = size == 0 ? 1 : size == 1 ? 2 : 3, h = size == 0 ? 1 : 2;
        b.decreaseCrates();
        b.decreaseCrateArea(w * h);
        for (int i = 0; i < w; i++) for (int j = 0; j < h; j++) b.setPiece(x + i, H - 1 - j, -1);
        crate.invoke(points, w, h);
        collected++;
      }
    }
    if (any) endStep.invoke(points);
    return any;
  }

  boolean runs(ForageBoard b) throws Exception {
    List<?> found = (List<?>) findRuns.invoke(matcher, b, points);
    if (found.isEmpty()) return false;
    matchStep.invoke(points, b, found);
    return true;
  }

  static final int MOVES = 200;

  static void clear(ForageBoard b, int x, int y) {
    int p = b.getPiece(x, y);
    if (p != -1 && (p & 65535) != 100) b.noteCleared(x, y);
    b.setPiece(x, y, -1);
  }

  boolean fireMoon(ForageBoard b) throws Exception {
    p moons = ((WerewolfForageBoard)b).getMoons();
    s moon = moons.f();
    if (moon == null) return false;
    k blast = moons.n(moon, b);
    moons.n(true);
    for (Map.Entry<Integer, Integer> cell : blast.n.entrySet()) {
      int x = p.n(cell.getKey()), y = p.z(cell.getKey());
      if (b.getPiece(x, y) != -1 && !crateAt(b.getPiece(x, y))) clear(b, x, y);
    }
    moons.n(false);
    endStep.invoke(points);
    return true;
  }

  static String moons(ForageBoard b) {
    StringJoiner out = new StringJoiner(",", "[", "]");
    for (s moon : ((WerewolfForageBoard)b).getMoons().z())
      out.add("[" + moon.n + "," + moon.z + "," + moon.f + "," + moon.g + "," + moon.p + "]");
    return out.toString();
  }

  /** Whether turning the 2x2 at (x, y) would line up three of a kind. */
  static boolean makesRun(ForageBoard b, int x, int y, boolean ccw) {
    int[] c = cells(b);
    int bl = c[(y + 1) * W + x], tl = c[y * W + x], tr = c[y * W + x + 1], br = c[(y + 1) * W + x + 1];
    if (ccw) { c[(y + 1) * W + x] = tl; c[y * W + x] = tr; c[y * W + x + 1] = br; c[(y + 1) * W + x + 1] = bl; }
    else { c[(y + 1) * W + x] = br; c[y * W + x] = bl; c[y * W + x + 1] = tl; c[(y + 1) * W + x + 1] = tr; }
    for (int yy = 0; yy < H; yy++) for (int xx = 0; xx < W; xx++) {
      int p = c[yy * W + xx];
      if (p < 0 || p >= 5) continue;
      if (xx + 2 < W && c[yy * W + xx + 1] == p && c[yy * W + xx + 2] == p) return true;
      if (yy + 2 < H && c[(yy + 1) * W + xx] == p && c[(yy + 2) * W + xx] == p) return true;
    }
    return false;
  }

  public static void main(String[] args) throws Exception {
    init();
    long[] seeds = {0L, 1L, 42L, 123456789L, -7L, 281474976710655L};
    int[] difficulties = {8, 8, 2, 8, 1, 0};
    StringBuilder out = new StringBuilder("[");
    for (int s = 0; s < seeds.length; s++) {
      WerewolfForageParity game = new WerewolfForageParity();
      ForageBoard b = new WerewolfForageBoard(W, H, difficulties[s]);
      b.initializeSeed(seeds[s]);
      // A new game forgets any crate size still waiting to fit ).
      resetSpawner.invoke(dropper);
      Random r = new Random(seeds[s] * 31 + 5);
      out.append(s > 0 ? "," : "").append("{\"seed\":\"").append(seeds[s]).append("\",\"difficulty\":").append(difficulties[s])
        .append(",\"startMoons\":").append(moons(b)).append(",\"start\":").append(Arrays.toString(cells(b)).replace(" ", "")).append(",\"moves\":[");
      for (int m = 0; m < MOVES; m++) {
        int x = r.nextInt(W), y = r.nextInt(H);
        boolean ccw = r.nextBoolean();
        int pick = r.nextInt(10);
        if (pick < 3) {
          // Click a tool often, so tools, the monkey, earthquakes and ants all get played.
          List<int[]> tools = new ArrayList<>();
          for (int yy = 0; yy < H; yy++) for (int xx = 0; xx < W; xx++) if (tool(b.getPiece(xx, yy))) tools.add(new int[]{xx, yy});
          if (!tools.isEmpty()) { int[] t = tools.get(r.nextInt(tools.size())); x = t[0]; y = t[1]; }
        } else if (pick < 8) {
          // Otherwise mostly turns that make a run, so combos, specials and crates come along.
          List<int[]> good = new ArrayList<>();
          for (int yy = 0; yy < H - 1; yy++) for (int xx = 0; xx < W - 1; xx++) for (int d = 0; d < 2; d++)
            if (b.isLegalRotate(xx, yy) && makesRun(b, xx, yy, d == 0)) good.add(new int[]{xx, yy, d});
          if (!good.isEmpty()) { int[] t = good.get(r.nextInt(good.size())); x = t[0]; y = t[1]; ccw = t[2] == 0; }
        }
        if (!tool(b.getPiece(x, y))) { x = Math.min(x, W - 2); y = Math.min(y, H - 2); }
        // The game's crate request, applied as the player moves (as the controller does).
        int bonus = 0;
        if (b.getBonusMode() == 0 && b.getCrates() < 3 && b.getCrateArea() < 9 && r.nextInt(3) > 0) {
          int roll = r.nextInt(20), size = roll < 11 ? 0 : roll < 18 ? 1 : 2;
          bonus = 64 | size | (r.nextInt(3) << 2);
        }
        String outcome;
        int tl = b.getPiece(x, y);
        if (!tool(tl) && !b.isLegalRotate(x, y)) outcome = "illegal";
        else if (at(b, x, y + 1) == at(b, x, y) && at(b, x, y) == at(b, x + 1, y + 1) && at(b, x + 1, y + 1) == at(b, x + 1, y)) {
          turn(b, x, y, ccw);
          outcome = "same";
        } else {
          outcome = "moved";
          if (bonus != 0) b.setBonusMode((byte) bonus);
          if (tl == 5) {
            for (int yy = y; yy < H; yy++) if (!crateAt(b.getPiece(x, yy))) clear(b, x, yy);
          } else if (tl == 6) {
            for (int xx = 0; xx < W; xx++) if ((ccw ? xx <= x : xx >= x) && !crateAt(b.getPiece(xx, y))) clear(b, xx, y);
          } else if (tl == 7) {
            for (int dx = -2; dx <= 2; dx++) for (int dy = -2; dy <= 2; dy++) {
              int tx = x + dx, ty = y + dy;
              if (b.inBounds(tx, ty) && !crateAt(b.getPiece(tx, ty))) b.setPiece(tx, ty, b.getNextPiece(false));
            }
          } else if (tl == 8) {
            clear(b, x, y);
            int edge = ccw ? 0 : W - 1;
            for (int yy = 0; yy < H; yy++) if (!crateAt(b.getPiece(edge, yy))) clear(b, edge, yy);
            slide.invoke(slider, b, null, !ccw);
          } else turn(b, x, y, ccw);
          endStep.invoke(points);
          // Settle until stable, the ants, then again.
          boolean ants = true;
          for (;;) {
            if ((Integer) drop.invoke(dropper, b, null) > 0 || game.collect(b) || game.runs(b) || game.fireMoon(b) || (Integer) spawn.invoke(dropper, b, null) > 0) continue;
            if (ants) { ants = false; b.tickAnts(null); continue; }
            ((WerewolfForageBoard)b).getMoons().z(b);
            break;
          }
        }
        int moveCombo = combo.getInt(b);
        int moveTotal = total.getInt(points);
        b.clearComboCount();
        resetPoints.invoke(points);
        out.append(m > 0 ? "," : "").append("{\"x\":").append(x).append(",\"y\":").append(y).append(",\"ccw\":").append(ccw)
          .append(",\"bonus\":").append(outcome.equals("moved") ? bonus : 0).append(",\"outcome\":\"").append(outcome).append("\"")
          .append(",\"moons\":").append(moons(b)).append(",\"points\":").append(moveTotal).append(",\"combo\":").append(moveCombo)
          .append(",\"crates\":").append(b.getCrates()).append(",\"area\":").append(b.getCrateArea())
          .append(",\"pending\":").append(b.getBonusMode()).append(",\"collected\":").append(game.collected)
          .append(m % 4 == 3 || m == MOVES - 1 ? ",\"board\":" + Arrays.toString(cells(b)).replace(" ", "") : "").append("}");
      }
      out.append("]}");
    }
    System.out.println(out.append("]"));
  }
}
