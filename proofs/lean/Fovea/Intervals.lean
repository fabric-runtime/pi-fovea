import Mathlib.Tactic
namespace Fovea

def ceilDiv (n d : Nat) : Nat := n / d + if n % d = 0 then 0 else 1

theorem floorDiv_bounds (n d : Nat) (hd : 0 < d) :
    d * (n / d) ≤ n ∧ n < d * (n / d + 1) := by
  have h := Nat.mod_add_div n d
  have hr := Nat.mod_lt n hd
  simp only [Nat.mul_add, Nat.mul_one]
  omega

theorem ceilDiv_bounds (n d : Nat) (hd : 0 < d) :
    n ≤ d * ceilDiv n d ∧ d * ceilDiv n d < n + d := by
  have h := Nat.mod_add_div n d
  have hr := Nat.mod_lt n hd
  unfold ceilDiv
  split_ifs with hz
  · simp only [Nat.add_zero]
    omega
  · have hp : 0 < n % d := Nat.pos_of_ne_zero hz
    simp only [Nat.mul_add, Nat.mul_one]
    omega

theorem add_enclosure {al a au bl b bu : ℝ}
    (ha : al ≤ a ∧ a ≤ au) (hb : bl ≤ b ∧ b ≤ bu) :
    al + bl ≤ a + b ∧ a + b ≤ au + bu := by constructor <;> linarith [ha.1,ha.2,hb.1,hb.2]

theorem multiply_enclosure {al a au bl b bu : ℝ}
    (ha0 : 0 ≤ al) (hb0 : 0 ≤ bl)
    (ha : al ≤ a ∧ a ≤ au) (hb : bl ≤ b ∧ b ≤ bu) :
    al * bl ≤ a * b ∧ a * b ≤ au * bu := by
  constructor
  · exact mul_le_mul ha.1 hb.1 hb0 (ha0.trans ha.1)
  · exact mul_le_mul ha.2 hb.2 (hb0.trans hb.1) (ha0.trans ha.1 |>.trans ha.2)

theorem divide_enclosure {al a au bl b bu : ℝ}
    (ha0 : 0 ≤ al) (hb0 : 0 < bl)
    (ha : al ≤ a ∧ a ≤ au) (hb : bl ≤ b ∧ b ≤ bu) :
    al / bu ≤ a / b ∧ a / b ≤ au / bl := by
  have hbpos : 0 < b := hb0.trans_le hb.1
  have hbupos : 0 < bu := hbpos.trans_le hb.2
  constructor
  · apply (div_le_div_iff₀ hbupos hbpos).2
    exact mul_le_mul ha.1 hb.2 (le_of_lt hbpos) (ha0.trans ha.1)
  · apply (div_le_div_iff₀ hbpos hb0).2
    exact mul_le_mul ha.2 hb.1 (le_of_lt hb0) (ha0.trans ha.1 |>.trans ha.2)

theorem signed_enclosure {pl p pu nl n nu : ℝ}
    (hp : pl ≤ p ∧ p ≤ pu) (hn : nl ≤ n ∧ n ≤ nu) :
    pl - nu ≤ p - n ∧ p - n ≤ pu - nl := by constructor <;> linarith [hp.1,hp.2,hn.1,hn.2]

theorem certificate_error_bound {lower actual upper candidate epsilon : ℝ}
    (hencl : lower ≤ actual ∧ actual ≤ upper)
    (hlo : |candidate-lower| ≤ epsilon) (hhi : |candidate-upper| ≤ epsilon) :
    |candidate-actual| ≤ epsilon := by
  rw [abs_le] at *
  constructor <;> linarith [hencl.1,hencl.2,hlo.1,hlo.2,hhi.1,hhi.2]

end Fovea
