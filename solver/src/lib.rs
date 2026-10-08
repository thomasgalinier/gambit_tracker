//! Thin wasm-bindgen wrapper: build a heads-up postflop game, solve it step by step,
//! then walk the tree and read the strategy / EV of one hand or of a whole range.
use postflop_solver::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Solver {
    game: PostFlopGame,
    iteration: u32,
}

fn err<E: ToString>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[wasm_bindgen]
impl Solver {
    /// board: "Td9d6h" (3 to 5 cards). sizes: "33%, 75%" style strings (PioSOLVER-like).
    #[wasm_bindgen(constructor)]
    pub fn new(
        oop_range: &str, ip_range: &str, board: &str, pot: i32, stack: i32,
        flop_bet: &str, flop_raise: &str, turn_bet: &str, turn_raise: &str, river_bet: &str, river_raise: &str,
    ) -> Result<Solver, JsValue> {
        let cards: Vec<Card> = (0..board.len() / 2).map(|i| card_from_str(&board[2 * i..2 * i + 2])).collect::<Result<_, _>>().map_err(err)?;
        if cards.len() < 3 || cards.len() > 5 { return Err(err("board must have 3 to 5 cards")); }
        let card_config = CardConfig {
            range: [oop_range.parse().map_err(err)?, ip_range.parse().map_err(err)?],
            flop: [cards[0], cards[1], cards[2]],
            turn: *cards.get(3).unwrap_or(&NOT_DEALT),
            river: *cards.get(4).unwrap_or(&NOT_DEALT),
        };
        let size = |b: &str, r: &str| BetSizeOptions::try_from((b, r)).map_err(err);
        let (f, t, r) = (size(flop_bet, flop_raise)?, size(turn_bet, turn_raise)?, size(river_bet, river_raise)?);
        let tree_config = TreeConfig {
            initial_state: [BoardState::Flop, BoardState::Turn, BoardState::River][cards.len() - 3],
            starting_pot: pot,
            effective_stack: stack,
            rake_rate: 0.0,
            rake_cap: 0.0,
            flop_bet_sizes: [f.clone(), f],
            turn_bet_sizes: [t.clone(), t],
            river_bet_sizes: [r.clone(), r],
            turn_donk_sizes: None,
            river_donk_sizes: None,
            add_allin_threshold: 1.5,
            force_allin_threshold: 0.15,
            merging_threshold: 0.1,
        };
        let tree = ActionTree::new(tree_config).map_err(err)?;
        let game = PostFlopGame::with_config(card_config, tree).map_err(err)?;
        Ok(Solver { game, iteration: 0 })
    }

    /// Memory needed in MB: [uncompressed, compressed]
    pub fn memory_mb(&self) -> Vec<f64> {
        let (a, b) = self.game.memory_usage();
        vec![a as f64 / 1048576.0, b as f64 / 1048576.0]
    }

    pub fn allocate(&mut self, compressed: bool) {
        self.game.allocate_memory(compressed);
    }

    /// Run `n` more iterations and return the exploitability (in chips).
    pub fn run(&mut self, n: u32) -> f32 {
        for _ in 0..n {
            solve_step(&self.game, self.iteration);
            self.iteration += 1;
        }
        compute_exploitability(&self.game)
    }

    pub fn finalize(&mut self) {
        finalize(&mut self.game);
    }

    // ---------- navigation ----------
    pub fn back_to_root(&mut self) { self.game.back_to_root(); }
    pub fn play(&mut self, action: usize) { self.game.play(action); }
    pub fn is_terminal(&self) -> bool { self.game.is_terminal_node() }
    pub fn is_chance(&self) -> bool { self.game.is_chance_node() }
    pub fn current_player(&self) -> usize { self.game.current_player() }
    pub fn total_bet(&self) -> Vec<i32> { self.game.total_bet_amount().to_vec() }

    /// Available actions as "Check|Bet:120|AllIn:900|Fold|Call|Raise:300"
    pub fn actions(&self) -> String {
        self.game.available_actions().iter().map(|a| match a {
            Action::Fold => "Fold".to_string(),
            Action::Check => "Check".to_string(),
            Action::Call => "Call".to_string(),
            Action::Bet(x) => format!("Bet:{x}"),
            Action::Raise(x) => format!("Raise:{x}"),
            Action::AllIn(x) => format!("AllIn:{x}"),
            Action::Chance(c) => format!("Chance:{c}"),
            Action::None => "None".to_string(),
        }).collect::<Vec<_>>().join("|")
    }

    /// Deal a turn/river card at a chance node ("7s").
    pub fn deal(&mut self, card: &str) -> Result<(), JsValue> {
        let c = card_from_str(card).map_err(err)?;
        if self.game.possible_cards() & (1u64 << c) == 0 { return Err(err("card not possible")); }
        self.game.play(c as usize);
        Ok(())
    }

    fn hand_index(&self, player: usize, hand: &str) -> Option<usize> {
        let a = card_from_str(&hand[0..2]).ok()?;
        let b = card_from_str(&hand[2..4]).ok()?;
        self.game.private_cards(player).iter().position(|&(x, y)| (x, y) == (a, b) || (x, y) == (b, a))
    }

    /// Strategy of the current player for one hand: one frequency per action. Empty if the hand is not in range.
    pub fn hand_strategy(&self, hand: &str) -> Vec<f32> {
        let p = self.game.current_player();
        let Some(i) = self.hand_index(p, hand) else { return vec![] };
        let n = self.game.private_cards(p).len();
        let s = self.game.strategy();
        (0..s.len() / n).map(|k| s[i + k * n]).collect()
    }

    /// Range-wide frequency of each action for the current player.
    pub fn range_strategy(&mut self) -> Vec<f32> {
        let p = self.game.current_player();
        self.game.cache_normalized_weights();
        let w = self.game.normalized_weights(p).to_vec();
        let n = w.len();
        let s = self.game.strategy();
        let tot: f32 = w.iter().sum();
        (0..s.len() / n).map(|k| (0..n).map(|i| s[i + k * n] * w[i]).sum::<f32>() / tot.max(1e-9)).collect()
    }

    /// [equity, EV] of one hand for `player` at the current node (NaN if not in range).
    pub fn hand_values(&mut self, player: usize, hand: &str) -> Vec<f32> {
        self.game.cache_normalized_weights();
        let Some(i) = self.hand_index(player, hand) else { return vec![f32::NAN, f32::NAN] };
        vec![self.game.equity(player)[i], self.game.expected_values(player)[i]]
    }

    /// Reach-weighted range of `player` at the current node as "AhKh:0.370,..." (max weight scaled to 1).
    /// Used to chain streets: the turn solve starts from the ranges that actually reach the turn.
    pub fn range_at(&mut self, player: usize) -> String {
        self.game.cache_normalized_weights();
        let w = self.game.normalized_weights(player).to_vec();
        let max = w.iter().cloned().fold(0f32, f32::max);
        if max <= 0.0 { return String::new(); }
        self.game.private_cards(player).iter().zip(w.iter())
            .filter(|(_, &x)| x / max >= 0.001)
            .map(|(&(a, b), &x)| { let (hi, lo) = if a >= b { (a, b) } else { (b, a) }; format!("{}{}:{:.3}", card_to_string(hi).unwrap(), card_to_string(lo).unwrap(), x / max) })
            .collect::<Vec<_>>().join(",")
    }

    /// EV of each action for one hand of the current player.
    pub fn hand_action_evs(&mut self, hand: &str) -> Vec<f32> {
        let p = self.game.current_player();
        self.game.cache_normalized_weights();
        let Some(i) = self.hand_index(p, hand) else { return vec![] };
        let n = self.game.private_cards(p).len();
        let d = self.game.expected_values_detail(p);
        (0..d.len() / n).map(|k| d[i + k * n]).collect()
    }
}
