// Test build 20261018210340. Uses the game's own board, matcher, scorer and wild helper.
// javac -cp <code jar> -d <output> NavigationParity.java
// java -cp <code jar>;<output> NavigationParity > navigation-parity.json
import com.threerings.piracy.puzzle.duty.navi.RingBoard;
import com.threerings.piracy.puzzle.duty.navi.y;
import java.lang.reflect.*;
import java.util.*;

public class NavigationParity {
  static Class<?> scorerClass, wildClass;
  static Object matcher;
  static Method match, reset, scoreStep, total, targetCheck, targetClear, wildRuns, wildAction, wildCompleted, wildNext;
  static Object scorer() throws Exception { Object s=scorerClass.getConstructor().newInstance();reset.invoke(s);return s; }
  static void init() throws Exception {
    scorerClass=Class.forName("com.threerings.piracy.puzzle.duty.navi.u.n");
    wildClass=Class.forName("com.threerings.piracy.puzzle.duty.navi.u.z");
    Class<?> m=Class.forName("com.threerings.piracy.puzzle.duty.navi.u.b");
    matcher=m.getConstructor().newInstance(); match=m.getMethod("u",RingBoard.class,scorerClass);
    reset=scorerClass.getMethod("u");scoreStep=scorerClass.getMethod("b");total=scorerClass.getMethod("k");
    Class<?> t=Class.forName("com.threerings.piracy.puzzle.duty.navi.u.u");
    targetCheck=t.getMethod("u",RingBoard.class,y.class);targetClear=t.getMethod("u",RingBoard.class,y.class,scorerClass);
    wildRuns=wildClass.getMethod("u",List.class,y.class);wildAction=wildClass.getMethod("b");
    wildCompleted=wildClass.getMethod("u",y.class);wildNext=wildClass.getMethod("b",y.class);
  }
  static String targets(y t) { StringJoiner j=new StringJoiner(",","[","]");for(int i=0;i<t.u();i++) j.add("["+t.b(i)+","+t.q(i)+","+t.u(i)+","+t.k(i)+"]");return j.toString(); }
  static String cells(RingBoard b) { StringJoiner j=new StringJoiner(",","[","]");for(int ring=0;ring<b.getRingCount();ring++)for(int o=0;o<8;o++)j.add(""+b.getPiece(o,ring));return j.toString(); }
  static String runs(List<?> runs) throws Exception { StringJoiner j=new StringJoiner(",","[","]");for(Object run:runs){Class<?> c=run.getClass();j.add("["+c.getField("q").get(run)+","+c.getField("k").get(run)+","+c.getField("g").get(run)+","+c.getField("n").get(run)+"]");}return j.toString(); }
  public static void main(String[] args) throws Exception {
    init();StringJoiner cases=new StringJoiner(",","[","]");
    // Werewolf Isle deals dense constellations: always 3/2/1 targets, innermost ring first.
    for(boolean dense:new boolean[]{false,true})for(int rings:new int[]{3,4})for(int d:new int[]{0,4,9})for(long seed:new long[]{1,42,8675309}) {
      RingBoard b=new RingBoard(rings,d);b.setDenseConstellations(dense);b.initializeSeed(seed);
      StringJoiner entries=new StringJoiner(",","[","]"), constellations=new StringJoiner(",","[","]");
      for(int i=0;i<120;i++){int p=b.getNextPiece(),o=b.getNextOctant();entries.add("["+o+","+p+"]");y t=new y();b.getNextConstellation(t);constellations.add(targets(t));}
      cases.add("{\"dense\":"+dense+",\"rings\":"+rings+",\"difficulty\":"+d+",\"seed\":"+seed+",\"entries\":"+entries+",\"targets\":"+constellations+"}");
    }
    Random rng=new Random(1701);StringJoiner matches=new StringJoiner(",","[","]");
    for(int rings:new int[]{3,4})for(int i=0;i<200;i++) {
      RingBoard b=new RingBoard(rings,4);for(int ring=0;ring<rings;ring++)for(int o=0;o<8;o++)b.setPiece(o,ring,rng.nextInt(6)-1);
      // Force wraparound and radial runs into some otherwise random boards.
      if(i%3==0)for(int o:new int[]{7,0,1})b.setPiece(o,0,i%5);
      if(i%5==0)for(int ring=0;ring<rings;ring++)b.setPiece(4,ring,i%5);
      String before=cells(b);Object s=scorer();List<?> found=(List<?>)match.invoke(matcher,b,s);scoreStep.invoke(s);
      matches.add("{\"rings\":"+rings+",\"before\":"+before+",\"runs\":"+runs(found)+",\"after\":"+cells(b)+",\"points\":"+total.invoke(s)+"}");
    }
    // One, two or three run-clear passes before the constellation completes: two or more
    // also add an extra wild target to the next constellation's inner ring.
    StringJoiner wildCases=new StringJoiner(",","[","]");
    for(boolean dense:new boolean[]{false,true})for(int rings:new int[]{3,4})for(boolean enabled:new boolean[]{false,true})for(int i=0;i<60;i++) {
      Object helper=wildClass.getConstructor(boolean.class,int.class).newInstance(enabled,rings);wildClass.getMethod("u").invoke(helper);
      y t=new y();RingBoard generator=new RingBoard(rings,4);generator.setDenseConstellations(dense);generator.initializeSeed(i+1);generator.getNextConstellation(t);
      String before=targets(t);StringJoiner steps=new StringJoiner(",","[","]");
      for(int j=0;j<1+i%3;j++) {
        RingBoard b=new RingBoard(rings,4);for(int o:new int[]{7,0,1})b.setPiece(o,j%rings,2);
        List<?> found=(List<?>)match.invoke(matcher,b,scorer());wildRuns.invoke(helper,found,t);
        steps.add("{\"runs\":"+runs(found)+",\"targets\":"+targets(t)+"}");
      }
      wildCompleted.invoke(helper,t);String completed=targets(t);
      t.q();generator.getNextConstellation(t);wildNext.invoke(helper,t);
      String next=targets(t);wildAction.invoke(helper);
      wildCases.add("{\"dense\":"+dense+",\"rings\":"+rings+",\"enabled\":"+enabled+",\"seed\":"+(i+1)+",\"before\":"+before+",\"steps\":"+steps+",\"completed\":"+completed+",\"next\":"+next+"}");
    }
    // A constellation completed after earlier passes of the same evolution is multiplied by the
    // chain count, as the controller ends the pass straight after clearing it.
    StringJoiner scores=new StringJoiner(",","[","]");
    for(int rings:new int[]{3,4})for(int i=0;i<100;i++) {
      RingBoard b=new RingBoard(rings,i%10);b.initializeSeed(i+1);y t=new y();b.getNextConstellation(t);
      for(int j=0;j<t.u();j++){if(j%2==0)t.g(j);b.setPiece(t.b(j),t.q(j),j%2==0?(t.u(j)+1)%5:t.u(j));}
      int chain=1+i%3;
      boolean satisfied=(Boolean)targetCheck.invoke(null,b,t);Object s=scorer();for(int c=1;c<chain;c++)scoreStep.invoke(s);
      targetClear.invoke(null,b,t,s);scoreStep.invoke(s);
      scores.add("{\"rings\":"+rings+",\"chain\":"+chain+",\"targets\":"+targets(t)+",\"matches\":"+satisfied+",\"points\":"+total.invoke(s)+",\"after\":"+cells(b)+"}");
    }
    System.out.println("{\"build\":\"20261018210340\",\"generation\":"+cases+",\"matches\":"+matches+",\"wild\":"+wildCases+",\"scores\":"+scores+"}");
  }
}
