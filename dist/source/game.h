#ifndef POP_RECONSTRUCTED_GAME_H
#define POP_RECONSTRUCTED_GAME_H

/* Independent, editable gameplay reconstruction. All positions are room-local
 * pixels; x is the actor's center and y is the actor's feet. Room IDs retain
 * the ROM's 1..24 convention. Levels are zero based (0..13). */
enum {
    GAME_WIDTH = 320, GAME_HEIGHT = 192,
    GAME_TILE_WIDTH = 32, GAME_TILE_HEIGHT = 64,
    GAME_TILE_FLOOR_OFFSET = 56,
    GAME_INPUT_LEFT = 1, GAME_INPUT_RIGHT = 2,
    GAME_INPUT_UP = 4, GAME_INPUT_DOWN = 8,
    GAME_INPUT_JUMP = 16, GAME_INPUT_ACTION = 32,
    GAME_INPUT_RESTART = 64
};
enum {
    GAME_STAND, GAME_RUN, GAME_CROUCH, GAME_JUMP, GAME_FALL,
    GAME_HANG, GAME_CLIMB, GAME_HURT, GAME_DEAD, GAME_SWORD,
    GAME_ATTACK, GAME_DRINK, GAME_FINISH, GAME_LOWER, GAME_RELEASE
};
enum { GAME_FLAG_DEAD = 1, GAME_FLAG_LEVEL_COMPLETE = 2,
       GAME_FLAG_COMPLETE = 4, GAME_FLAG_PAUSED = 8 };
enum { GAME_LINK_LEFT, GAME_LINK_RIGHT, GAME_LINK_UP, GAME_LINK_DOWN };
enum { GAME_GUARD_IDLE, GAME_GUARD_MOVE, GAME_GUARD_ATTACK,
       GAME_GUARD_PARRY, GAME_GUARD_HURT, GAME_GUARD_DEAD };

void game_init(void);
int game_select_level(int level);
void game_reset(void);
void game_set_input(int mask);
void game_set_paused(int paused);
/* Optional invincibility, frozen clock and pit rescue. Off after game_init;
 * preserved across restarts and level changes. Enabling also restores health. */
void game_set_god_mode(int enabled);
int game_get_god_mode(void);
void game_step(void);               /* Exactly one 1/60 second simulation tick. */
void game_update(int ticks);        /* Clamped to 0..600 ticks. */

int game_get_level_count(void);
int game_get_level(void);
int game_get_room(void);
int game_get_tick(void);
int game_get_flags(void);
int game_get_time_left(void);       /* Seconds; starts at one hour. */
int game_get_health(void);
int game_get_max_health(void);
int game_get_has_sword(void);
int game_get_player_x(void);
int game_get_player_y(void);
int game_get_player_vx(void);       /* Fixed point, 256 units = one pixel/tick. */
int game_get_player_vy(void);
int game_get_player_facing(void);   /* -1 left, +1 right. */
int game_get_player_state(void);
int game_get_player_grounded(void);
int game_get_player_height(void);
int game_get_player_animation(void);
/* Native sprite anchor and explicit frame for recovered ledge sequences.
 * A frame of -1 leaves other reconstructed animations to the renderer. */
int game_get_player_render_x(void);
int game_get_player_render_y(void);
int game_get_player_native_frame(void);
int game_get_player_attack_frame(void);
int game_get_player_invulnerable(void);

int game_get_room_present(int room);
int game_get_link(int room, int direction);
int game_get_tile(int room, int position);  /* Current raw NES tile byte. */
int game_get_initial_tile(int room, int position);
int game_get_gate(int room, int position);  /* Opening, 0..64 pixels. */
int game_get_tile_state(int room, int position);
int game_get_guard_active(int room);
int game_get_guard_visible(int room); /* Includes a fallen guard's body. */
int game_get_guard_x(int room);
int game_get_guard_y(int room);
int game_get_guard_health(int room);
int game_get_guard_facing(int room);
int game_get_guard_state(int room); /* 0 idle,1 move,2 attack,3 parry,4 hurt,5 dead. */
int game_get_guard_animation(int room);
int game_get_guard_native_frame(int room);
int game_get_guard_render_x(int room);
int game_get_guard_render_y(int room);
int game_get_guard_raw(int room);
int game_get_event_count(void);
int game_get_event_value(int event, int field); /* srcRoom,srcPos,action,dstRoom,dstPos */
int game_get_theme(void);
int game_get_start_room(void);
int game_get_start_position(void);
int game_get_effect_count(void);
int game_get_effect_value(int effect, int field); /* active,room,x,y,type */
int game_get_last_event(void);      /* 0 none,1 land,2 jump,3 gate,4 hurt,
                                     5 sword hit,6 pickup,7 loose floor,8 win. */

/* Runtime editor/debug hooks. Changes are bounded and survive level resets,
 * but game_init restores the extracted campaign. They also support native
 * tests without replacing the recovered ROM data. */
int game_edit_tile(int level, int room, int position, int raw);
int game_edit_link(int level, int room, int direction, int target);
int game_edit_spawn(int level, int room, int position, int facing);
int game_edit_guard(int level, int room, int raw);
int game_edit_event(int level, int index, int source_room, int source_position,
                    int action, int target_room, int target_position);
int game_set_player(int room, int x, int y, int facing);
void game_set_health(int health);
void game_set_has_sword(int has_sword);
int game_trigger(int room, int position);

#endif
